"""Single source of truth for the 15 admin question types.

Both the admin panel (via ``GET /admin/question-templates``) and the
server-side save validation read from here, so the form the admin sees and the
rules the backend enforces can never drift apart.

Each template maps to a database ``Task.type`` plus an interaction ``kind``
(the renderer/grader selector from :mod:`app.services.exercise_registry`).
``mode`` decides how questions are collected:

* ``repeat``          — every question is its own row (1..N inside the exercise)
* ``composite:<x>``   — the whole exercise is one structure (matching, ordering,
  cloze) with a bespoke editor.
"""

from typing import Any


# fmt: off
QUESTION_TEMPLATES: dict[str, dict[str, Any]] = {
    "multiple_choice":      {"label": "Multiple choice",          "task_type": "multiple_choice",            "kind": "multiple_choice",    "mode": "repeat",            "per": ["prompt", "options", "correct_single"],            "manual": False},
    "multi_select":         {"label": "Multi select",             "task_type": "multi_select",               "kind": "multiple_choice",    "mode": "repeat",            "per": ["prompt", "options", "correct_multi"],             "manual": False},
    "true_false":           {"label": "True / False",             "task_type": "true_false",                 "kind": "binary_choice",      "mode": "repeat",            "per": ["prompt", "correct_binary"],                       "manual": False},
    "true_false_not_given": {"label": "True / False / Not Given",  "task_type": "true_false_not_given",       "kind": "binary_choice",      "mode": "repeat",            "per": ["prompt", "correct_tfng"],                         "manual": False},
    "gap_fill":             {"label": "Gap fill",                 "task_type": "gap_fill",                   "kind": "guided_input",       "mode": "repeat",            "per": ["prompt_gap", "correct_text", "accepted", "textcfg"], "manual": False},
    "dropdown_gap_fill":    {"label": "Dropdown gap fill",        "task_type": "dropdown_gap_fill",          "kind": "dropdown_gap_fill",  "mode": "repeat",            "per": ["prompt_gap", "options", "correct_single"],        "manual": False},
    "short_answer":         {"label": "Short answer",             "task_type": "short_answer",               "kind": "short_answer",       "mode": "repeat",            "per": ["prompt", "correct_text", "accepted", "textcfg"],  "manual": False},
    "error_correction":     {"label": "Error correction",         "task_type": "error_correction",           "kind": "correction",         "mode": "repeat",            "per": ["prompt", "correct_text", "accepted", "textcfg"],  "manual": False},
    "inline_alternatives":  {"label": "Inline alternatives",      "task_type": "multiple_choice",            "kind": "inline_alternatives", "mode": "repeat",           "per": ["prompt_alt", "correct_alt"],                      "manual": False},
    "writing":              {"label": "Writing",                  "task_type": "writing",                    "kind": "long_text",          "mode": "repeat",            "per": ["prompt"], "manual": True, "ex_words": True},
    "speaking_prompt":      {"label": "Speaking",                 "task_type": "speaking_prompt_placeholder", "kind": "long_text",         "mode": "repeat",            "per": ["prompt"], "manual": True, "ex_prep": True},
    "matching_pairs":       {"label": "Matching pairs",           "task_type": "matching_pairs",             "kind": "matching",           "mode": "composite:matching"},
    "gap_match":            {"label": "Word box + match replies", "task_type": "gap_fill",                   "kind": "gap_match",          "mode": "composite:gapmatch"},
    "matching_headings":    {"label": "Matching headings",        "task_type": "matching_headings",          "kind": "matching_headings",  "mode": "composite:matching", "passage": True},
    "sentence_ordering":    {"label": "Sentence ordering",        "task_type": "sentence_ordering",          "kind": "ordering",           "mode": "composite:ordering"},
    "word_ordering":        {"label": "Word ordering",            "task_type": "word_ordering",              "kind": "ordering",           "mode": "composite:wordorder"},
    "cloze_passage":        {"label": "Cloze passage",            "task_type": "gap_fill",                   "kind": "cloze_passage",      "mode": "composite:cloze"},
}
# fmt: on


def templates_payload() -> dict[str, dict[str, Any]]:
    """The object served to the admin panel to build its adaptive form."""
    return QUESTION_TEMPLATES


def _has(template: dict[str, Any], field: str) -> bool:
    return field in template.get("per", [])


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, dict)):
        return len(value) == 0
    return False


def validate_task_payload(template_key: str, task_type: str, questions: list[dict[str, Any]],
                          interaction: dict[str, Any] | None, passage_html: str | None) -> list[str]:
    """Fail fast on save so a variantless/answerless question is never stored.

    Returns a list of human-readable Uzbek error messages (empty == valid).
    Mirrors the client-side checks in the exercise builder so both layers agree.
    """
    template = QUESTION_TEMPLATES.get(template_key)
    if not template:
        return [f"Noma'lum savol turi: {template_key}."]

    errors: list[str] = []
    mode = template["mode"]
    interaction = interaction or {}

    if template.get("passage") and _is_blank(passage_html):
        errors.append("Reading passage is empty.")

    if mode == "repeat":
        for index, question in enumerate(questions, start=1):
            is_example = bool(question.get("is_example"))
            if template.get("manual"):
                continue
            if (_has(template, "prompt") or _has(template, "prompt_gap") or _has(template, "prompt_alt")) \
                    and _is_blank(question.get("prompt")) and not is_example:
                errors.append(f"Question {index}: prompt is empty.")
            if _has(template, "options"):
                options = [str(o).strip() for o in (question.get("options") or []) if str(o).strip()]
                if len(options) < 2 and not is_example:
                    errors.append(f"Question {index}: at least 2 options are required.")
            if _has(template, "correct_alt"):
                options = question.get("options") or []
                if len(options) != 2 and not is_example:
                    errors.append(f"Question {index}: write 'word1 / word2' in the prompt.")
            needs_answer = any(_has(template, f) for f in (
                "correct_single", "correct_multi", "correct_binary", "correct_tfng", "correct_text", "correct_alt",
            ))
            if needs_answer and _is_blank(question.get("correct_answer")) and not is_example:
                errors.append(f"Question {index}: correct answer is missing.")
    elif mode.startswith("composite:"):
        kind = mode.split(":", 1)[1]
        if kind == "matching":
            options = interaction.get("options") or []
            if len(options) < 2:
                errors.append("The right column needs at least 2 options.")
            if len(questions) < 2:
                errors.append("The left column needs at least 2 prompts.")
            for index, question in enumerate(questions, start=1):
                if _is_blank(question.get("correct_answer")):
                    errors.append(f"Prompt {index}: no match selected.")
        elif kind in {"ordering", "wordorder"}:
            first = questions[0] if questions else {}
            sequence = first.get("correct_answer") or []
            if not isinstance(sequence, list) or len(sequence) < 2:
                errors.append("At least 2 items are required.")
        elif kind == "cloze":
            if _is_blank(interaction.get("template")):
                errors.append("The passage template is empty.")
            for question in questions:
                if _is_blank(question.get("correct_answer")) and not question.get("is_example"):
                    errors.append(f"{{{{{question.get('order_index', '?')}}}}}: answer is missing.")
        elif kind == "gapmatch":
            if len(interaction.get("words") or []) < 2:
                errors.append("The word box needs at least 2 words.")
            if len(interaction.get("options") or []) < 2:
                errors.append("At least 2 replies are required.")
            if len(questions) < 2:
                errors.append("At least one question (word + reply pair) is required.")
            for index, question in enumerate(questions, start=1):
                if _is_blank(question.get("correct_answer")) and not question.get("is_example"):
                    errors.append(f"Row {index}: answer is missing.")

    return errors
