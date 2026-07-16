from dataclasses import dataclass


@dataclass(frozen=True)
class ExerciseSpec:
    kind: str
    task_types: frozenset[str]
    renderer: str
    grading: str
    requires_options: bool = False
    manual_review: bool = False


EXERCISE_REGISTRY: dict[str, ExerciseSpec] = {
    "word_bank": ExerciseSpec(
        "word_bank", frozenset({"gap_fill"}), "WordBankExercise",
        "exact_or_accepted", requires_options=True,
    ),
    "cloze_passage": ExerciseSpec(
        "cloze_passage", frozenset({"gap_fill"}), "ClozePassageExercise",
        "exact_or_accepted",
    ),
    "inline_alternatives": ExerciseSpec(
        "inline_alternatives", frozenset({"multiple_choice"}),
        "InlineAlternativesExercise", "selected_value",
    ),
    "multiple_choice": ExerciseSpec(
        "multiple_choice", frozenset({"multiple_choice", "multi_select"}),
        "ChoiceCardsExercise", "selected_value", requires_options=True,
    ),
    "binary_choice": ExerciseSpec(
        "binary_choice", frozenset({"true_false", "true_false_not_given"}),
        "BinaryChoiceExercise", "normalized_bool_label",
    ),
    "matching": ExerciseSpec(
        "matching", frozenset({"matching_pairs"}), "MatchingExercise",
        "selected_value", requires_options=True,
    ),
    # Two-part exercise from coursebooks: fill each question's gap with a word
    # from a box, THEN match the question with a reply. Questions alternate:
    # odd order_index = the word gap (text answer), even = the reply (letter).
    "gap_match": ExerciseSpec(
        "gap_match", frozenset({"gap_fill"}), "GapMatchExercise",
        "exact_or_accepted", requires_options=True,
    ),
    "matching_headings": ExerciseSpec(
        "matching_headings", frozenset({"matching_headings"}),
        "MatchingHeadingsExercise", "selected_value", requires_options=True,
    ),
    "ordering": ExerciseSpec(
        "ordering", frozenset({"sentence_ordering", "word_ordering"}),
        "OrderingExercise", "normalized_sequence",
    ),
    "correction": ExerciseSpec(
        "correction", frozenset({"error_correction"}), "CorrectionExercise",
        "exact_or_fuzzy_review",
    ),
    "guided_input": ExerciseSpec(
        "guided_input", frozenset({"gap_fill", "short_answer"}),
        "GuidedInputExercise", "exact_or_accepted",
    ),
    "short_answer": ExerciseSpec(
        "short_answer", frozenset({"short_answer"}), "ShortAnswerExercise",
        "exact_or_accepted",
    ),
    "dropdown_gap_fill": ExerciseSpec(
        "dropdown_gap_fill", frozenset({"dropdown_gap_fill"}),
        "DropdownGapFillExercise", "selected_value", requires_options=True,
    ),
    "long_text": ExerciseSpec(
        "long_text", frozenset({"writing", "rich_text_question", "speaking_prompt_placeholder"}),
        "LongTextExercise", "manual", manual_review=True,
    ),
    "rich_text": ExerciseSpec(
        "rich_text", frozenset({"rich_text_question"}),
        "LongTextExercise", "manual", manual_review=True,
    ),
}


MANUAL_TASK_TYPES = frozenset(
    task_type
    for spec in EXERCISE_REGISTRY.values()
    if spec.manual_review
    for task_type in spec.task_types
)


def registry_payload() -> list[dict]:
    return [
        {
            "kind": spec.kind,
            "task_types": sorted(spec.task_types),
            "renderer": spec.renderer,
            "grading": spec.grading,
            "requires_options": spec.requires_options,
            "manual_review": spec.manual_review,
        }
        for spec in EXERCISE_REGISTRY.values()
    ]


def interaction_matches_type(kind: str, task_type: str) -> bool:
    spec = EXERCISE_REGISTRY.get(kind)
    return bool(spec and task_type in spec.task_types)


DEFAULT_KIND_BY_TASK_TYPE = {
    "multiple_choice": "multiple_choice",
    "multi_select": "multiple_choice",
    "true_false": "binary_choice",
    "true_false_not_given": "binary_choice",
    "matching_pairs": "matching",
    "matching_headings": "matching_headings",
    "sentence_ordering": "ordering",
    "word_ordering": "ordering",
    "gap_fill": "guided_input",
    "dropdown_gap_fill": "dropdown_gap_fill",
    "error_correction": "correction",
    "short_answer": "short_answer",
    "writing": "long_text",
    "rich_text_question": "long_text",
    "speaking_prompt_placeholder": "long_text",
}


def default_kind(task_type: str) -> str:
    return DEFAULT_KIND_BY_TASK_TYPE.get(task_type, "rich_text")
