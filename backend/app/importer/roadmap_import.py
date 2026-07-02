import asyncio
import mimetypes
import re
import shutil
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Callable
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import SessionLocal
from app.importer.roadmap import AnswerKey, ParsedTest, RoadmapDocumentParser, discover_tests
from app.models import (
    ContentStatus, ExamType, Level, MediaAsset, Question, Section, Task, TestVariant, User,
)
from app.services.exercise_registry import EXERCISE_REGISTRY, MANUAL_TASK_TYPES, interaction_matches_type

SOURCE_ROOT = Path("/data/source-archive")


def parsed_quality_errors(parsed: ParsedTest, audios: dict[tuple[str, str, int, int], Path]) -> list[str]:
    errors: list[str] = []
    for task in parsed.tasks:
        scope = f"{task.section} / Exercise {task.exercise_number}"
        kind = task.interaction.get("kind")
        if not kind or kind not in EXERCISE_REGISTRY:
            errors.append(f"{scope}: interaction kind is missing or unknown")
        elif not interaction_matches_type(kind, task.question_type):
            errors.append(f"{scope}: {kind} is incompatible with {task.question_type}")
        if task.confidence < 0.8:
            errors.append(f"{scope}: parser confidence is {task.confidence:.2f}")
        errors.extend(f"{scope}: {warning}" for warning in task.warnings)
        if task.recording_number and (
            parsed.level, parsed.exam_slug, parsed.variant, task.recording_number
        ) not in audios:
            errors.append(f"{scope}: Recording {task.recording_number} media is missing")
        spec = EXERCISE_REGISTRY.get(kind)
        if spec and spec.requires_options and not task.interaction.get("options") and not any(
            question.options for question in task.questions
        ):
            errors.append(f"{scope}: interaction options are empty")
        for question in task.questions:
            if question.is_example:
                continue
            if task.question_type not in MANUAL_TASK_TYPES and question.correct_answer in (None, "", []):
                errors.append(f"{scope} / Question {question.number}: correct answer is missing")
    return errors


def audio_index(root: Path) -> dict[tuple[str, str, int, int], Path]:
    result: dict[tuple[str, str, int, int], Path] = {}
    deferred: dict[tuple[str, str], list[Path]] = defaultdict(list)
    for path in [*root.rglob("*.mp3"), *root.rglob("*.mp4"), *root.rglob("*.wav"), *root.rglob("*.m4a")]:
        joined = "/".join(path.parts).casefold()
        level = next((name for name in ("Pre-Intermediate", "Intermediate", "Elementary", "Beginner") if name.casefold() in joined), None)
        exam = "mid-course" if "/mid/" in joined else "end-course" if "/end/" in joined else None
        match = re.search(r"(?:Mid|End)\s*(\d+)\s*R(\d+)", path.stem, re.I)
        if level and exam and match:
            result[(level, exam, int(match.group(1)), int(match.group(2)))] = path
        elif level and exam:
            deferred[(level, exam)].append(path)
    for (level, exam), files in deferred.items():
        used_variants = {key[2] for key in result if key[:2] == (level, exam)}
        variant = next((n for n in range(1, 5) if n not in used_variants), 1)
        for recording, path in enumerate(sorted(files), start=1):
            result[(level, exam, variant, recording)] = path
    return result


def _renumber_cloze_template(parsed_task) -> None:
    """Question numbering is always renumbered 1..N per exercise before it's
    persisted (order_index). For a cloze_passage, the template's {{N}}
    placeholders (and example_values keys) reference the *original* gap
    numbers, which can have gaps of their own (e.g. an unrecognized first
    gap) — remap them in lockstep so the template still lines up with each
    question's new order_index after renumbering.
    """
    if parsed_task.interaction.get("kind") != "cloze_passage":
        return
    ordered = sorted(parsed_task.questions, key=lambda item: item.number)
    remap = {str(question.number): str(new_number) for new_number, question in enumerate(ordered, start=1)}
    template = parsed_task.interaction.get("template", "")
    parsed_task.interaction["template"] = re.sub(
        r"\{\{(\d+)\}\}", lambda match: "{{" + remap.get(match.group(1), match.group(1)) + "}}", template,
    )
    example_values = parsed_task.interaction.get("example_values") or {}
    parsed_task.interaction["example_values"] = {remap.get(key, key): value for key, value in example_values.items()}
    for question in ordered:
        question.number = int(remap[str(question.number)])


async def persist_parsed(
    db,
    parsed: ParsedTest,
    level_row: Level,
    exam_type_row: ExamType,
    admin_id: uuid.UUID | None,
    source_document: str,
    resolve_audio: "Callable[[int], Path | None] | None" = None,
    media_cache: dict[Path, MediaAsset] | None = None,
    status: ContentStatus | None = None,
) -> TestVariant:
    """Write a parsed test (and its sections/tasks/questions) into the DB.

    Shared by the offline CLI importer (roadmap_import.import_all, which
    resolves audio via the source-archive's folder layout) and the web
    bulk-import commit endpoint (which has no audio to attach and passes
    resolve_audio=None). Caller is responsible for db.commit().
    """
    if media_cache is None:
        media_cache = {}
    if status is None:
        # No caller-supplied audio index to check recordings against here;
        # callers that care about that (the CLI importer) pass status explicitly.
        status = ContentStatus.PUBLISHED if not parsed_quality_errors(parsed, {}) else ContentStatus.NEEDS_REVIEW
    variant = TestVariant(
        level_id=level_row.id,
        exam_type_id=exam_type_row.id,
        title=parsed.title,
        variant_number=parsed.variant,
        instructions="Complete every section. Your answers save automatically.",
        time_limit_minutes=60,
        passing_percentage=60,
        retake_allowed=True,
        review_allowed=True,
        status=status,
        created_by=admin_id,
    )
    db.add(variant)
    await db.flush()

    section_rows: dict[str, Section] = {}
    for parsed_task in parsed.tasks:
        if parsed_task.section not in section_rows:
            section = Section(
                test_variant_id=variant.id,
                title=parsed_task.section,
                order_index=len(section_rows) + 1,
            )
            db.add(section)
            await db.flush()
            section_rows[parsed_task.section] = section

        media_id = None
        if parsed_task.recording_number and resolve_audio:
            audio_path = resolve_audio(parsed_task.recording_number)
            if audio_path:
                if audio_path not in media_cache:
                    relative = Path("audio") / parsed.level.casefold().replace(" ", "-") / parsed.exam_slug / audio_path.name
                    target = settings.storage_path / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(audio_path, target)
                    media = MediaAsset(
                        file_name=audio_path.name,
                        file_url=f"/media/{quote(relative.as_posix(), safe='/')}",
                        mime_type=mimetypes.guess_type(audio_path.name)[0] or "audio/mpeg",
                        uploaded_by=admin_id,
                    )
                    db.add(media)
                    await db.flush()
                    media_cache[audio_path] = media
                media_id = media_cache[audio_path].id
            else:
                parsed_task.warnings.append(
                    f"Recording {parsed_task.recording_number} could not be matched to media."
                )

        _renumber_cloze_template(parsed_task)
        task = Task(
            section_id=section_rows[parsed_task.section].id,
            type=parsed_task.question_type,
            title=parsed_task.title,
            instructions=parsed_task.instructions,
            passage_html=parsed_task.passage,
            media_asset_id=media_id,
            order_index=parsed_task.exercise_number,
            metadata_json={
                "source_document": source_document,
                "confidence": parsed_task.confidence,
                "warnings": parsed_task.warnings,
                "context_kind": parsed_task.section.casefold(),
                "interaction": parsed_task.interaction,
            },
        )
        db.add(task)
        await db.flush()
        for order, parsed_question in enumerate(
            sorted(parsed_task.questions, key=lambda item: item.number), start=1,
        ):
            db.add(Question(
                task_id=task.id,
                prompt=parsed_question.prompt,
                options=parsed_question.options,
                correct_answer=parsed_question.correct_answer,
                accepted_answers=parsed_question.accepted_answers,
                points=0 if parsed_question.is_example else 1,
                is_example=parsed_question.is_example,
                order_index=order,
            ))
    return variant


async def import_all(source_root: Path = SOURCE_ROOT) -> dict[str, int]:
    key_paths = {
        level: next(path for path in source_root.rglob("*.docx") if "answer" in path.name.casefold() and marker in path.name.casefold())
        for level, marker in {
            "Beginner": "beginner", "Elementary": "elem",
            "Pre-Intermediate": "pre", "Intermediate": "inter",
        }.items()
    }
    keys = {level: AnswerKey(path) for level, path in key_paths.items()}
    audios = audio_index(source_root)
    stats = {"tests": 0, "sections": 0, "tasks": 0, "questions": 0, "media": 0, "skipped": 0}

    async with SessionLocal() as db:
        levels = {row.name: row for row in (await db.execute(select(Level))).scalars()}
        exam_types = {row.slug: row for row in (await db.execute(select(ExamType))).scalars()}
        admin = await db.scalar(select(User).order_by(User.created_at))
        media_cache: dict[Path, MediaAsset] = {}
        for path, level_name, exam_slug, variant_number in discover_tests(source_root):
            parsed = RoadmapDocumentParser(keys[level_name]).parse(path, level_name, exam_slug, variant_number)
            existing = await db.scalar(select(TestVariant.id).where(
                TestVariant.level_id == levels[level_name].id,
                TestVariant.exam_type_id == exam_types[exam_slug].id,
                TestVariant.variant_number == variant_number,
            ))
            if existing:
                stats["skipped"] += 1
                continue
            quality_errors = parsed_quality_errors(parsed, audios)
            variant = await persist_parsed(
                db, parsed, levels[level_name], exam_types[exam_slug],
                admin.id if admin else None,
                source_document=str(path.relative_to(source_root)),
                resolve_audio=lambda recording, _l=level_name, _e=exam_slug, _v=variant_number: audios.get(
                    (_l, _e, _v, recording),
                ),
                media_cache=media_cache,
                status=ContentStatus.PUBLISHED if not quality_errors else ContentStatus.NEEDS_REVIEW,
            )
            stats["tests"] += 1
            stats["sections"] += len({task.section for task in parsed.tasks})
            stats["tasks"] += len(parsed.tasks)
            stats["questions"] += sum(len(task.questions) for task in parsed.tasks)
            stats["media"] += len({
                task.recording_number for task in parsed.tasks
                if task.recording_number and audios.get((level_name, exam_slug, variant_number, task.recording_number))
            })
        await db.commit()
    return stats


async def enrich_interactions(source_root: Path = SOURCE_ROOT) -> dict[str, int]:
    """Add safe student-facing interaction metadata without replacing tests or attempts."""
    key_paths = {
        level: next(path for path in source_root.rglob("*.docx") if "answer" in path.name.casefold() and marker in path.name.casefold())
        for level, marker in {
            "Beginner": "beginner", "Elementary": "elem",
            "Pre-Intermediate": "pre", "Intermediate": "inter",
        }.items()
    }
    keys = {level: AnswerKey(path) for level, path in key_paths.items()}
    audios = audio_index(source_root)
    parsed_tests = {
        (level_name, exam_slug, variant_number): RoadmapDocumentParser(keys[level_name]).parse(
            path, level_name, exam_slug, variant_number,
        )
        for path, level_name, exam_slug, variant_number in discover_tests(source_root)
    }
    updated = 0
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(TestVariant, Level, ExamType)
            .join(Level, Level.id == TestVariant.level_id)
            .join(ExamType, ExamType.id == TestVariant.exam_type_id)
            .options(
                selectinload(TestVariant.sections)
                .selectinload(Section.tasks)
                .selectinload(Task.questions)
            )
        )).all()
        for variant, level, exam_type in rows:
            parsed = parsed_tests.get((level.name, exam_type.slug, variant.variant_number))
            if not parsed:
                continue
            quality_errors = parsed_quality_errors(parsed, audios)
            if quality_errors and variant.status == ContentStatus.PUBLISHED:
                variant.status = ContentStatus.NEEDS_REVIEW
            task_rows = {
                (section.title.casefold(), task.order_index): task
                for section in variant.sections
                for task in section.tasks
            }
            for parsed_task in parsed.tasks:
                task = task_rows.get((parsed_task.section.casefold(), parsed_task.exercise_number))
                if not task:
                    continue
                changed = False
                if task.type != parsed_task.question_type:
                    task.type = parsed_task.question_type
                    changed = True
                metadata = dict(task.metadata_json or {})
                if metadata.pop("superseded", None) is not None:
                    task.metadata_json = metadata
                    changed = True
                if metadata.get("interaction") != parsed_task.interaction:
                    metadata["interaction"] = parsed_task.interaction
                    task.metadata_json = metadata
                    changed = True
                if metadata.get("confidence") != parsed_task.confidence:
                    metadata["confidence"] = parsed_task.confidence
                    task.metadata_json = metadata
                    changed = True
                if metadata.get("warnings", []) != parsed_task.warnings:
                    metadata["warnings"] = parsed_task.warnings
                    task.metadata_json = metadata
                    changed = True
                for index, parsed_question in enumerate(parsed_task.questions):
                    if index < len(task.questions):
                        question = task.questions[index]
                    else:
                        question = Question(
                            task_id=task.id,
                            prompt=parsed_question.prompt,
                            order_index=index + 1,
                        )
                        db.add(question)
                        task.questions.append(question)
                        changed = True
                    values = {
                        "prompt": parsed_question.prompt,
                        "order_index": index + 1,
                        "options": parsed_question.options,
                        "correct_answer": parsed_question.correct_answer,
                        "accepted_answers": parsed_question.accepted_answers,
                        "is_example": parsed_question.is_example,
                        "points": 0 if parsed_question.is_example else 1,
                    }
                    for field_name, value in values.items():
                        if getattr(question, field_name) != value:
                            setattr(question, field_name, value)
                            changed = True
                    if (question.rich_content or {}).get("superseded"):
                        content = dict(question.rich_content or {})
                        content.pop("superseded", None)
                        question.rich_content = content
                        changed = True
                for question in task.questions[len(parsed_task.questions):]:
                    content = dict(question.rich_content or {})
                    if not content.get("superseded"):
                        content["superseded"] = True
                        question.rich_content = content
                        changed = True
                merged = parsed_task.interaction.get("merged_exercises", [])
                for merged_order in merged[1:]:
                    superseded = task_rows.get((parsed_task.section.casefold(), merged_order))
                    if superseded:
                        superseded_metadata = dict(superseded.metadata_json or {})
                        if not superseded_metadata.get("superseded"):
                            superseded_metadata["superseded"] = True
                            superseded_metadata["superseded_by"] = task.order_index
                            superseded.metadata_json = superseded_metadata
                            updated += 1
                if changed:
                    updated += 1
        await db.commit()
    return {"updated_tasks": updated}


if __name__ == "__main__":
    print(asyncio.run(import_all()))
