"""The AI import pipeline's pure logic: answer normalisation, payload
building and JSON extraction — everything that guards imported content."""
from app.services.docx_import import (
    _extract_json, build_task_payloads, normalise_answer,
)


# ── normalise_answer ────────────────────────────────────────────────────────

def test_option_letter_maps_to_option_text():
    value, problem = normalise_answer("options_single", ["James", "Christina", "Matt"], "b")
    assert problem is None
    assert value == "Christina"


def test_option_text_matches_case_insensitively():
    value, problem = normalise_answer("options_single", ["Tea", "Coffee"], "tea")
    assert value == "Tea" and problem is None


def test_unknown_option_is_rejected():
    value, problem = normalise_answer("options_single", ["a1", "b2"], "zzz")
    assert value is None and problem


def test_binary_answers_normalise():
    assert normalise_answer("binary", [], "t")[0] == "True"
    assert normalise_answer("binary", [], "F")[0] == "False"
    assert normalise_answer("binary", [], "ng", tfng=True)[0] == "Not Given"
    assert normalise_answer("binary", [], "maybe")[1] is not None


def test_matching_accepts_only_known_letters():
    options = [{"value": "a", "label": "one"}, {"value": "b", "label": "two"}]
    assert normalise_answer("matching", options, "B")[0] == "b"
    assert normalise_answer("matching", options, "z")[0] is None


def test_free_text_is_stripped():
    assert normalise_answer("text", [], "  porridge  ")[0] == "porridge"
    assert normalise_answer("text", [], "   ")[1] is not None


# ── _extract_json ───────────────────────────────────────────────────────────

def test_extract_json_tolerates_code_fences():
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_extract_json_tolerates_surrounding_prose():
    assert _extract_json('Here you go: {"a": 1} hope it helps') == {"a": 1}


def test_extract_json_returns_none_on_garbage():
    assert _extract_json("no json here") is None


# ── build_task_payloads ─────────────────────────────────────────────────────

def _mc_exercise():
    return {
        "template_key": "multiple_choice",
        "instructions": "Choose the correct answer.",
        "passage": "", "min_words": None, "max_words": None,
        "section": "Listening", "title": "Recording 1",
        "questions": [
            {"prompt": "Q one", "options": ["x", "y"], "correct_answer": "y",
             "is_example": False, "uncertain": False},
        ],
    }


def test_multiple_choice_payload_shape():
    payloads, warnings = build_task_payloads([_mc_exercise()])
    assert len(payloads) == 1
    task = payloads[0]
    assert task["type"] == "multiple_choice"
    assert task["interaction"]["kind"] == "multiple_choice"
    assert task["questions"][0]["correct_answer"] == "y"


def test_unmatched_answer_falls_back_with_warning():
    exercise = _mc_exercise()
    exercise["questions"][0]["correct_answer"] = "not-an-option"
    payloads, warnings = build_task_payloads([exercise])
    assert payloads[0]["questions"][0]["correct_answer"] == "x"
    assert any("defaulted" in warning for warning in warnings)


def test_gap_match_builds_alternating_word_and_reply_rows():
    exercise = {
        "template_key": "gap_match",
        "instructions": "Complete and match.",
        "passage": "", "min_words": None, "max_words": None,
        "section": "Function", "title": "Words + replies",
        "words": ["mum", "often"],
        "right": ["She is a teacher.", "Every hour."],
        "questions": [
            {"prompt": "What does your ___ do?", "word": "mum", "reply": "a", "is_example": True},
            {"prompt": "How ___ does she listen?", "word": "often", "reply": "b", "is_example": False},
        ],
    }
    payloads, warnings = build_task_payloads([exercise])
    task = payloads[0]
    assert task["template_key"] == "gap_match"
    assert task["interaction"]["words"] == ["mum", "often"]
    rows = task["questions"]
    assert len(rows) == 4  # word + reply per item
    assert rows[0]["correct_answer"] == "mum" and rows[0]["is_example"] is True
    assert rows[1]["correct_answer"] == "a" and rows[1]["prompt"].startswith("Reply")
    assert rows[3]["correct_answer"] == "b"


def test_matching_pairs_payload():
    exercise = {
        "template_key": "matching_pairs",
        "instructions": "Match.",
        "passage": "", "min_words": None, "max_words": None,
        "section": "", "title": "Match it",
        "left": ["one", "two"], "right": ["A", "B"], "pairs": ["b", "a"],
        "questions": [],
    }
    payloads, _ = build_task_payloads([exercise])
    task = payloads[0]
    assert [option["value"] for option in task["interaction"]["options"]] == ["a", "b"]
    assert [question["correct_answer"] for question in task["questions"]] == ["b", "a"]


def test_true_false_answers_normalise_in_payload():
    exercise = {
        "template_key": "true_false",
        "instructions": "Write true or false.",
        "passage": "", "min_words": None, "max_words": None,
        "section": "", "title": "TF",
        "questions": [
            {"prompt": "S1", "options": [], "correct_answer": "T", "is_example": False, "uncertain": False},
            {"prompt": "S2", "options": [], "correct_answer": "false", "is_example": False, "uncertain": False},
        ],
    }
    payloads, _ = build_task_payloads([exercise])
    answers = [question["correct_answer"] for question in payloads[0]["questions"]]
    assert answers == ["True", "False"]
