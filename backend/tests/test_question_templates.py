"""Save-time validation — the gate that keeps broken exercises out of the DB."""
from app.services.question_templates import validate_task_payload


def _question(**overrides):
    base = {"prompt": "Q", "options": [], "correct_answer": "x", "is_example": False, "order_index": 1}
    base.update(overrides)
    return base


def test_repeat_question_requires_answer():
    errors = validate_task_payload(
        "gap_fill", "gap_fill",
        [_question(correct_answer="")], {"kind": "guided_input"}, None,
    )
    assert any("answer" in error.lower() for error in errors)


def test_example_question_may_be_blank():
    errors = validate_task_payload(
        "gap_fill", "gap_fill",
        [_question(correct_answer="", is_example=True)], {"kind": "guided_input"}, None,
    )
    assert errors == []


def test_multiple_choice_needs_two_options():
    errors = validate_task_payload(
        "multiple_choice", "multiple_choice",
        [_question(options=["only one"])], {"kind": "multiple_choice"}, None,
    )
    assert any("2 options" in error for error in errors)


def test_gap_match_requires_words_and_replies():
    errors = validate_task_payload(
        "gap_match", "gap_fill",
        [_question(), _question(order_index=2)],
        {"kind": "gap_match", "words": ["one"], "options": []}, None,
    )
    assert any("word box" in error.lower() for error in errors)
    assert any("replies" in error.lower() for error in errors)


def test_gap_match_valid_payload_passes():
    errors = validate_task_payload(
        "gap_match", "gap_fill",
        [_question(correct_answer="mum"), _question(order_index=2, correct_answer="a")],
        {
            "kind": "gap_match",
            "words": ["mum", "often"],
            "options": [{"value": "a", "label": "reply one"}, {"value": "b", "label": "reply two"}],
        }, None,
    )
    assert errors == []


def test_unknown_template_is_rejected():
    errors = validate_task_payload("no_such_type", "gap_fill", [], {}, None)
    assert errors
