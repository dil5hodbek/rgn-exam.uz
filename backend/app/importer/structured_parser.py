import re
import uuid
from pathlib import Path
from typing import Any

from rapidfuzz import fuzz, process

from app.importer.roadmap import AnswerKey, ParsedQuestion, ParsedTask, ParsedTest, RoadmapDocumentParser
from app.services.exercise_registry import default_kind
from app.services.question_classifier import classify_task

LEVELS = ["Beginner", "Elementary", "Pre-Intermediate", "Intermediate"]
# Marker substrings used to match a level's own answer-key document,
# mirroring roadmap_import.py's key_paths lookup.
LEVEL_MARKERS = {"Beginner": "beginner", "Elementary": "elem", "Pre-Intermediate": "pre", "Intermediate": "inter"}


def discover_generalized_tests(root: Path) -> list[tuple[Path, str | None, str | None, int | None]]:
    """Relaxed version of roadmap.discover_tests: never excludes a file just
    because level/exam/variant couldn't be determined from its path — those
    become None and the exercise-level review flow surfaces the gap instead.
    """
    result: list[tuple[Path, str | None, str | None, int | None]] = []
    for path in root.rglob("*.docx"):
        if path.name.startswith("~") or re.search(r"answer|key", path.stem, re.I):
            continue
        joined = "/".join(path.parts).casefold()
        level = next((name for name in LEVELS if name.casefold() in joined), None)
        if not level:
            match = process.extractOne(joined, LEVELS, scorer=fuzz.partial_ratio, score_cutoff=70)
            level = match[0] if match else None
        normalized = joined.replace("\\", "/")
        exam_slug = "mid-course" if re.search(r"(^|/)mid(/|$|-)", normalized) else (
            "end-course" if re.search(r"(^|/)end(/|$|-)", normalized) else None
        )
        variant_match = re.search(r"\bV(?:ariant)?\s*[-_ ]?(\d+)\b", path.stem, re.I)
        variant = int(variant_match.group(1)) if variant_match else None
        result.append((path, level, exam_slug, variant))
    return result


def find_answer_key(files: list[Path], level: str | None) -> Path | None:
    marker = LEVEL_MARKERS.get(level or "")
    candidates = [path for path in files if re.search(r"answer|key", path.stem, re.I)]
    matched = next((path for path in candidates if marker and marker in path.stem.casefold()), None)
    return matched or (candidates[0] if candidates else None)


def parse_archive(root: Path) -> dict[str, Any]:
    """Parse every recognizable test document under `root` into the
    hierarchical draft shape stored on ImportJob.result. Reuses
    RoadmapDocumentParser (it already works from parsed paragraphs alone,
    not from folder structure) for the actual document parsing.
    """
    all_docx = list(root.rglob("*.docx"))
    candidates = discover_generalized_tests(root)
    answer_keys: dict[str | None, AnswerKey] = {}

    def key_for(level: str | None) -> AnswerKey:
        if level not in answer_keys:
            key_path = find_answer_key(all_docx, level)
            answer_keys[level] = AnswerKey(key_path) if key_path else AnswerKey.empty()
        return answer_keys[level]

    tests: list[dict[str, Any]] = []
    totals = {"exercises": 0, "questions": 0, "needs_review": 0}
    for path, level, exam_slug, variant in candidates:
        parsed = RoadmapDocumentParser(key_for(level)).parse(path, level, exam_slug, variant)
        test_dict, exercise_count, question_count, needs_review_count = _serialize_test(parsed, path, root)
        tests.append(test_dict)
        totals["exercises"] += exercise_count
        totals["questions"] += question_count
        totals["needs_review"] += needs_review_count

    return {
        "summary": {"tests": len(tests), **totals},
        "tests": tests,
    }


def _serialize_test(parsed: ParsedTest, path: Path, root: Path) -> tuple[dict[str, Any], int, int, int]:
    sections: dict[str, list[dict[str, Any]]] = {}
    exercise_count = 0
    question_count = 0
    needs_review_count = 0
    for task in parsed.tasks:
        classification = classify_task(task.instructions, task.section)
        needs_review = classification.needs_review or task.confidence < 0.8
        exercise_dict = {
            "ref": str(uuid.uuid4()),
            "exercise_number": task.exercise_number,
            "title": task.title,
            "instructions": task.instructions,
            # None when classify_task couldn't confidently determine a type —
            # the admin UI must show "not detected" rather than a silent guess.
            "question_type": classification.question_type,
            # RoadmapDocumentParser's own best-effort type, kept for reference
            # and as the safe fallback if the admin commits without overriding.
            "suggested_type": task.question_type,
            "confidence": classification.confidence,
            "needs_review": needs_review,
            "reasons": classification.reasons,
            "interaction": task.interaction,
            "questions": [_serialize_question(question) for question in task.questions],
        }
        exercise_count += 1
        question_count += len(task.questions)
        if needs_review:
            needs_review_count += 1
        sections.setdefault(task.section, []).append(exercise_dict)

    test_dict = {
        "level": parsed.level, "exam_type": parsed.exam_slug, "variant": parsed.variant,
        "title": parsed.title, "source_document": str(path.relative_to(root)),
        "sections": [{"title": title, "exercises": items} for title, items in sections.items()],
    }
    return test_dict, exercise_count, question_count, needs_review_count


def _serialize_question(question: ParsedQuestion) -> dict[str, Any]:
    return {
        "ref": str(uuid.uuid4()),
        "number": question.number,
        "prompt": question.prompt,
        "options": question.options,
        "correct_answer": question.correct_answer,
        "accepted_answers": question.accepted_answers,
        "is_example": question.is_example,
    }


def find_exercise(data: dict[str, Any], ref: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    """Locate an exercise dict inside the draft by its stable `ref`. Returns
    (test, section, exercise) so callers that need section context (e.g. for
    reclassification) don't have to walk the tree twice.
    """
    for test in data.get("tests", []):
        for section in test.get("sections", []):
            for exercise in section.get("exercises", []):
                if exercise.get("ref") == ref:
                    return test, section, exercise
    return None


def draft_to_parsed_tests(data: dict[str, Any]) -> list[ParsedTest]:
    """Reverse of parse_archive's serialization, for turning a (possibly
    admin-edited) draft back into ParsedTest objects for persist_parsed().
    """
    results: list[ParsedTest] = []
    for test in data.get("tests", []):
        tasks: list[ParsedTask] = []
        for section in test.get("sections", []):
            for exercise in section.get("exercises", []):
                ordered_questions = sorted(
                    exercise.get("questions", []), key=lambda item: item.get("number", 0),
                )
                # Keep each question's original number here — persist_parsed()
                # is the single place that renumbers to 1..N, and for
                # cloze_passage exercises it needs the original numbers to
                # remap the template's {{N}} placeholders in lockstep.
                questions = [
                    ParsedQuestion(
                        number=item.get("number", index),
                        prompt=item.get("prompt", ""),
                        options=item.get("options", []),
                        correct_answer=item.get("correct_answer"),
                        accepted_answers=item.get("accepted_answers", []),
                        is_example=item.get("is_example", False),
                    )
                    for index, item in enumerate(ordered_questions, start=1)
                ]
                question_type = exercise.get("question_type") or exercise.get("suggested_type") or "rich_text_question"
                interaction = exercise.get("interaction") or {"kind": default_kind(question_type), "manual_review": True}
                tasks.append(ParsedTask(
                    exercise_number=exercise.get("exercise_number") or len(tasks) + 1,
                    title=exercise.get("title") or f"Exercise {len(tasks) + 1}",
                    instructions=exercise.get("instructions", ""),
                    question_type=question_type,
                    section=section.get("title") or "General",
                    interaction=interaction,
                    confidence=0.5 if exercise.get("needs_review") else 1.0,
                    warnings=[] if not exercise.get("needs_review") else ["Imported with a manually reviewed classification."],
                    questions=questions,
                ))
        results.append(ParsedTest(
            level=test.get("level") or "Unspecified",
            exam_slug=test.get("exam_type") or "general",
            variant=test.get("variant") or 1,
            title=test.get("title") or "Imported test",
            source_path=Path(test.get("source_document") or ""),
            tasks=tasks,
        ))
    return results
