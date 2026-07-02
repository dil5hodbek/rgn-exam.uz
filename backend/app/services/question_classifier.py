import re
from dataclasses import dataclass, field
from typing import Any

from app.services.exercise_registry import default_kind


def clean_text(value: str) -> str:
    value = value.replace("\xa0", " ").replace("\t", " | ")
    value = re.sub(r"[ ]{2,}", " ", value)
    return value.strip()


def infer_type(instructions: str, section: str) -> str:
    value = instructions.casefold()
    if "match" in value and "heading" in value and "paragraph" in value:
        return "matching_headings"
    if "not given" in value or "no information" in value:
        return "true_false_not_given"
    if "write true" in value:
        return "true_false"
    if "true" in value and "false" in value:
        return "true_false"
    if "tick" in value and "cross" in value:
        return "true_false"
    if "match" in value:
        return "matching_pairs"
    if "which questions" in value or "possible consequences" in value:
        return "matching_pairs"
    if re.search(r"\b(number|correct order|order they occur|put the words)\b", value):
        return "sentence_ordering"
    if (
        re.search(r"\b(choose|tick|circle|underline|find the correct answers?|correct answer|correct option|correct alternative|wrong word)\b", value)
        or re.search(r"\b[\w'’-]+\s*/\s*[\w'’-]+\b", value)
    ):
        return "multiple_choice"
    if re.search(r"\b(fill|complete|one word|missing words?|words? (?:and phrases )?in the box|first letter)\b", value):
        return "gap_fill"
    if re.search(r"\b(correct (?:the )?(?:mistakes?|punctuation)|rewrite|find (?:and )?correct)\b", value):
        return "error_correction"
    if re.search(r"\b(answer (?:the )?questions?|where was|find the facts?|what does .+ decide)\b", value):
        return "short_answer"
    if re.search(
        r"\b(write (?:an? )?(?:essay|article|email|letter|profile|biography|description|paragraph|response)"
        r"|write \d+\s*[–-]\s*\d+ words|write about|make (?:some )?notes|organise your ideas)\b",
        value,
    ):
        return "writing"
    if section.casefold() == "writing" and re.search(r"\b(write|notes?|paragraphs?)\b", value):
        return "writing"
    return "rich_text_question"


def extract_labelled_options(value: str) -> tuple[list[dict[str, str]], int | None]:
    markers = list(re.finditer(r"(?:^|\s)([a-hA-H])(?:[.)-]\s*|\s+)", value))
    best: list[re.Match[str]] = []
    for start_index, marker in enumerate(markers):
        if marker.group(1).casefold() != "a":
            continue
        sequence = [marker]
        expected = ord("b")
        for candidate in markers[start_index + 1:]:
            letter = candidate.group(1).casefold()
            if letter == chr(expected):
                sequence.append(candidate)
                expected += 1
            if expected > ord("h"):
                break
        if len(sequence) > len(best):
            best = sequence
    if len(best) < 2:
        return [], None
    result = []
    for index, marker in enumerate(best):
        end = best[index + 1].start() if index + 1 < len(best) else len(value)
        label = clean_text(value[marker.end():end]).strip(" |;,")
        if label:
            result.append({"value": marker.group(1).casefold(), "label": label})
    return result, best[0].start() if result else None


def extract_alternative_pair(prompt: str, answer: Any | None) -> dict[str, str] | None:
    if "/" not in prompt:
        return None
    before_slash, after_slash = prompt.split("/", 1)
    left_words = before_slash.rstrip().split()
    right_words = after_slash.lstrip().split()
    if not left_words or not right_words:
        return None
    answer_text = clean_text(str(answer)) if answer else ""
    word_count = max(1, len(answer_text.split())) if answer_text else 1
    left = " ".join(left_words[-word_count:]).strip(" ,;:.?!")
    right = " ".join(right_words[:word_count]).strip(" ,;:.?!")
    if answer_text:
        if before_slash.casefold().rstrip().endswith(answer_text.casefold()):
            left = answer_text
        elif after_slash.casefold().lstrip().startswith(answer_text.casefold()):
            right = answer_text
    before = before_slash[:before_slash.rfind(left)] if left and left in before_slash else before_slash
    right_start = after_slash.find(right)
    after = after_slash[right_start + len(right):] if right_start >= 0 else ""
    return {"before": before, "left": left, "right": right, "after": after}


@dataclass
class ClassificationResult:
    question_type: str | None
    interaction_kind: str
    confidence: float
    reasons: list[str] = field(default_factory=list)
    needs_review: bool = False


# Ordered rules mirroring infer_type()'s branch chain, annotated with a
# human-readable reason and a confidence so the admin UI can explain and
# rank a classification instead of silently guessing.
_CLASSIFICATION_RULES: list[tuple[Any, str, float, str]] = [
    (
        lambda value, section: "match" in value and "heading" in value and "paragraph" in value,
        "matching_headings", 0.95,
        "Instructions mention matching headings to paragraphs.",
    ),
    (
        lambda value, section: "not given" in value or "no information" in value,
        "true_false_not_given", 0.95,
        "Instructions mention 'not given' / 'no information'.",
    ),
    (
        lambda value, section: "write true" in value,
        "true_false", 0.9,
        "Instructions say 'write true'.",
    ),
    (
        lambda value, section: "true" in value and "false" in value,
        "true_false", 0.85,
        "Instructions contain both 'true' and 'false'.",
    ),
    (
        lambda value, section: "tick" in value and "cross" in value,
        "true_false", 0.85,
        "Instructions mention ticking or crossing an answer.",
    ),
    (
        lambda value, section: "match" in value,
        "matching_pairs", 0.75,
        "Instructions mention 'match'.",
    ),
    (
        lambda value, section: "which questions" in value or "possible consequences" in value,
        "matching_pairs", 0.8,
        "Instructions ask which item pairs with which consequence/question.",
    ),
    (
        lambda value, section: bool(re.search(r"\b(number|correct order|order they occur|put the words)\b", value)),
        "sentence_ordering", 0.85,
        "Instructions ask to number or order items.",
    ),
    (
        lambda value, section: bool(
            re.search(r"\b(choose|tick|circle|underline|find the correct answers?|correct answer|correct option|correct alternative|wrong word)\b", value)
            or re.search(r"\b[\w'’-]+\s*/\s*[\w'’-]+\b", value)
        ),
        "multiple_choice", 0.8,
        "Instructions ask to choose/circle/underline a correct option.",
    ),
    (
        lambda value, section: bool(re.search(r"\b(fill|complete|one word|missing words?|words? (?:and phrases )?in the box|first letter)\b", value)),
        "gap_fill", 0.8,
        "Instructions ask to fill in or complete missing words.",
    ),
    (
        lambda value, section: bool(re.search(r"\b(correct (?:the )?(?:mistakes?|punctuation)|rewrite|find (?:and )?correct)\b", value)),
        "error_correction", 0.85,
        "Instructions ask to correct mistakes or rewrite text.",
    ),
    (
        lambda value, section: bool(re.search(r"\b(answer (?:the )?questions?|where was|find the facts?|what does .+ decide)\b", value)),
        "short_answer", 0.75,
        "Instructions ask to answer open questions.",
    ),
    (
        lambda value, section: bool(re.search(
            r"\b(write (?:an? )?(?:essay|article|email|letter|profile|biography|description|paragraph|response)"
            r"|write \d+\s*[–-]\s*\d+ words|write about|make (?:some )?notes|organise your ideas)\b",
            value,
        )),
        "writing", 0.9,
        "Instructions ask the student to write an extended response.",
    ),
    (
        lambda value, section: section.casefold() == "writing" and bool(re.search(r"\b(write|notes?|paragraphs?)\b", value)),
        "writing", 0.7,
        "Exercise is in the Writing section and mentions writing/notes/paragraphs.",
    ),
]


def classify_task(instructions: str, section: str, sample_prompts: tuple[str, ...] = ()) -> ClassificationResult:
    """Classify a task's question type from its instructions/section.

    Unlike infer_type(), this never silently falls back to a guessed type:
    when no rule matches, question_type is None and needs_review is True so
    the admin UI can surface "not detected, pick manually" instead of a
    quietly-wrong classification.
    """
    value = instructions.casefold()
    for predicate, question_type, confidence, reason in _CLASSIFICATION_RULES:
        if predicate(value, section):
            interaction_kind = infer_interaction(question_type, instructions, section)["kind"]
            return ClassificationResult(
                question_type=question_type,
                interaction_kind=interaction_kind,
                confidence=confidence,
                reasons=[reason],
                needs_review=confidence < 0.8,
            )
    return ClassificationResult(
        question_type=None,
        interaction_kind="rich_text",
        confidence=0.3,
        reasons=["No keyword pattern matched this exercise's instructions; choose a type manually."],
        needs_review=True,
    )


def infer_interaction(question_type: str, instructions: str, section: str) -> dict[str, Any]:
    """Best-effort interaction kind derivable from type/instructions alone.

    Content-dependent payload (option lists, cloze templates, inline
    alternative pairs) is intentionally NOT produced here — that requires
    the actual parsed body/answer-key content and stays in the document
    parser that already builds it (RoadmapDocumentParser._questions).
    """
    instruction_text = instructions.casefold()
    if question_type == "sentence_ordering":
        return {"kind": "ordering"}
    if question_type == "multiple_choice" and "alternative" in instruction_text:
        return {"kind": "inline_alternatives"}
    if question_type in {"true_false", "true_false_not_given"}:
        return {"kind": "binary_choice"}
    if question_type == "multiple_choice":
        return {"kind": "multiple_choice"}
    if question_type == "gap_fill" and "box" in instruction_text:
        return {"kind": "word_bank"}
    if question_type == "gap_fill":
        return {"kind": "guided_input"}
    if question_type == "matching_pairs":
        return {"kind": "matching"}
    if question_type == "matching_headings":
        return {"kind": "matching_headings"}
    if question_type == "error_correction":
        return {"kind": "correction"}
    if question_type == "short_answer":
        return {"kind": "short_answer"}
    if question_type == "writing":
        range_match = re.search(r"(\d+)\s*[–-]\s*(\d+)\s*words", instructions, re.I)
        return {
            "kind": "long_text",
            "manual_review": True,
            "min_words": int(range_match.group(1)) if range_match else None,
            "max_words": int(range_match.group(2)) if range_match else None,
        }
    return {"kind": default_kind(question_type), "manual_review": default_kind(question_type) in {"long_text", "rich_text"}}
