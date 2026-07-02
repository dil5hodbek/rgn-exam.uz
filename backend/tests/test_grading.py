import unittest

from app.services.grading import grade_answer


class GradingTests(unittest.TestCase):
    def test_gap_fill_normalizes_case_and_spaces(self):
        result = grade_answer("gap_fill", "  Hello   WORLD ", "hello world", [], 2)
        self.assertTrue(result.is_correct)
        self.assertEqual(result.points, 2)

    def test_multi_select_requires_exact_set(self):
        self.assertTrue(grade_answer("multi_select", ["a", "b"], ["b", "a"], [], 1).is_correct)
        self.assertFalse(grade_answer("multi_select", ["a"], ["a", "b"], [], 1).is_correct)

    def test_missing_answer_key_goes_to_manual_review(self):
        result = grade_answer("gap_fill", "student answer", None, [], 1)
        self.assertIsNone(result.is_correct)
        self.assertTrue(result.needs_review)

    def test_writing_is_always_manual(self):
        result = grade_answer("writing", "A paragraph", None, [], 10)
        self.assertTrue(result.needs_review)

    def test_sentence_ordering_accepts_token_list(self):
        result = grade_answer(
            "sentence_ordering",
            ["happy", "family", "life"],
            "happy family life",
            [],
            1,
        )
        self.assertTrue(result.is_correct)
        self.assertEqual(result.points, 1)


if __name__ == "__main__":
    unittest.main()
