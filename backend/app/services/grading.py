import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from app.services.exercise_registry import MANUAL_TASK_TYPES

TRUE_FALSE_ALIASES = {
    "t": "true",
    "true": "true",
    "f": "false",
    "false": "false",
    "n": "not given",
    "ni": "not given",
    "ng": "not given",
    "not given": "not given",
    "no information": "not given",
}


@dataclass
class GradeResult:
    is_correct: bool | None
    points: float | None
    needs_review: bool = False


def normalize(value: Any, case_sensitive: bool = False, collapse_spaces: bool = True) -> Any:
    if isinstance(value, str):
        value = value.replace("’", "'").replace("‘", "'").replace("`", "'")
        value = re.sub(r"(?<=\w)[‐‑‒–—-](?=\w)", " ", value)
        value = value.strip()
        if collapse_spaces:
            value = re.sub(r"\s+", " ", value)
        normalized = value if case_sensitive else value.casefold()
        return TRUE_FALSE_ALIASES.get(normalized, normalized)
    if isinstance(value, list):
        return [normalize(item, case_sensitive, collapse_spaces) for item in value]
    if isinstance(value, dict):
        if "value" in value:
            return normalize(value["value"], case_sensitive, collapse_spaces)
        return {str(k): normalize(v, case_sensitive, collapse_spaces) for k, v in value.items()}
    return value


def grade_answer(
    question_type: str,
    student_answer: Any,
    correct_answer: Any,
    accepted_answers: list[Any],
    points: float,
    case_sensitive: bool = False,
    collapse_spaces: bool = True,
) -> GradeResult:
    if question_type in MANUAL_TASK_TYPES:
        return GradeResult(None, None, True)
    if correct_answer is None:
        return GradeResult(None, None, True)

    given = normalize(student_answer, case_sensitive, collapse_spaces)
    correct = normalize(correct_answer, case_sensitive, collapse_spaces)
    alternatives = [normalize(v, case_sensitive, collapse_spaces) for v in accepted_answers]

    if question_type in {"sentence_ordering", "word_ordering"}:
        if isinstance(given, list):
            given = " ".join(str(item) for item in given)
        if isinstance(correct, list):
            correct = " ".join(str(item) for item in correct)

    if question_type == "error_correction" and isinstance(given, str) and isinstance(correct, str):
        ratio = SequenceMatcher(None, given, correct).ratio()
        if ratio >= 0.94:
            return GradeResult(True, points)
        if ratio >= 0.72:
            return GradeResult(None, None, True)
        return GradeResult(False, 0)

    if question_type == "multi_select":
        matched = set(given or []) == set(correct or [])
    else:
        matched = given == correct or given in alternatives
    return GradeResult(matched, points if matched else 0)
