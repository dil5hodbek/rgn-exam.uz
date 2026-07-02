import unittest

from app.services.question_classifier import classify_task, infer_interaction


class ClassifyTaskTests(unittest.TestCase):
    def test_matching_headings(self):
        result = classify_task("Match the headings A-F with paragraphs 1-6.", "Reading")
        self.assertEqual(result.question_type, "matching_headings")
        self.assertFalse(result.needs_review)

    def test_true_false_not_given(self):
        result = classify_task("Write true (T), false (F) or no information (N).", "Reading")
        self.assertEqual(result.question_type, "true_false_not_given")

    def test_true_false(self):
        result = classify_task("Decide if the sentences are true or false.", "Reading")
        self.assertEqual(result.question_type, "true_false")

    def test_matching_pairs(self):
        result = classify_task("Match the speakers 1-3 with the opinions a-c.", "Listening")
        self.assertEqual(result.question_type, "matching_pairs")

    def test_sentence_ordering(self):
        result = classify_task("Number the sentences in the correct order.", "Writing")
        self.assertEqual(result.question_type, "sentence_ordering")

    def test_multiple_choice(self):
        result = classify_task("Choose the correct answer a, b or c.", "Grammar")
        self.assertEqual(result.question_type, "multiple_choice")
        self.assertFalse(result.needs_review)

    def test_gap_fill(self):
        result = classify_task("Complete the sentences. The first letter is given.", "Writing")
        self.assertEqual(result.question_type, "gap_fill")

    def test_error_correction(self):
        result = classify_task("Find and correct the mistakes in each sentence.", "Grammar")
        self.assertEqual(result.question_type, "error_correction")

    def test_short_answer(self):
        result = classify_task("Answer the questions about the text.", "Reading")
        self.assertEqual(result.question_type, "short_answer")

    def test_writing(self):
        result = classify_task("Write an essay of 120-180 words.", "Writing")
        self.assertEqual(result.question_type, "writing")
        self.assertFalse(result.needs_review)

    def test_writing_section_fallback(self):
        result = classify_task("Make some notes before you begin.", "Writing")
        self.assertEqual(result.question_type, "writing")

    def test_unclassifiable_instructions_need_review(self):
        result = classify_task("Look at the picture.", "General")
        self.assertIsNone(result.question_type)
        self.assertTrue(result.needs_review)
        self.assertTrue(result.reasons)

    def test_needs_review_reflects_low_confidence(self):
        result = classify_task("Match the words.", "Vocabulary")
        self.assertEqual(result.question_type, "matching_pairs")
        self.assertLess(result.confidence, 0.8)
        self.assertTrue(result.needs_review)


class RealArchiveInstructionTests(unittest.TestCase):
    """Instruction sentences quoted verbatim from the real Road Map archive
    (see PROMPT-2), one per documented question type.
    """

    def test_tick_the_correct_answer(self):
        self.assertEqual(classify_task("Tick the correct answer, a, b or c.", "Listening").question_type, "multiple_choice")

    def test_choose_the_correct_answer_to_complete(self):
        result = classify_task("Choose the correct answer, a, b or c to complete the sentences.", "Grammar")
        self.assertEqual(result.question_type, "multiple_choice")
        self.assertFalse(result.needs_review)

    def test_match_numbers_with_letters(self):
        self.assertEqual(classify_task("Match 1-8 with a-h.", "Vocabulary").question_type, "matching_pairs")

    def test_listen_again_write_true_false(self):
        result = classify_task("Recording 2 Listen again and write true (T) or false (F).", "Listening")
        self.assertEqual(result.question_type, "true_false")

    def test_complete_with_correct_verb_form(self):
        result = classify_task("Complete the sentences with the correct form of the verbs in brackets.", "Grammar")
        self.assertEqual(result.question_type, "gap_fill")

    def test_find_and_correct_the_mistake(self):
        self.assertEqual(classify_task("Find and correct the mistake in each sentence.", "Grammar").question_type, "error_correction")

    def test_complete_with_words_in_the_box(self):
        result = classify_task("Complete the sentences with the words in the box.", "Vocabulary")
        self.assertEqual(result.question_type, "gap_fill")
        self.assertEqual(infer_interaction(result.question_type, "Complete the sentences with the words in the box.", "Vocabulary")["kind"], "word_bank")

    def test_choose_the_correct_alternatives(self):
        result = classify_task("Choose the correct alternatives.", "Vocabulary")
        self.assertEqual(result.question_type, "multiple_choice")
        self.assertEqual(infer_interaction(result.question_type, "Choose the correct alternatives.", "Vocabulary")["kind"], "inline_alternatives")

    def test_two_category_consequences_matching(self):
        text = "Read the text and find the possible consequences of (L) little sleep and (E) enough sleep."
        result = classify_task(text, "Reading")
        self.assertEqual(result.question_type, "matching_pairs")
        self.assertFalse(result.needs_review)

    def test_match_headings_with_paragraphs(self):
        result = classify_task("Read the text. Match the headings 1-6 with the paragraphs A-F.", "Reading")
        self.assertEqual(result.question_type, "matching_headings")
        self.assertFalse(result.needs_review)

    def test_number_the_candidate_characteristics(self):
        self.assertEqual(
            classify_task("Number the characteristics of the candidate to recruit from 1 to 5.", "Listening").question_type,
            "sentence_ordering",
        )

    def test_put_the_words_in_correct_order(self):
        # infer_type has no separate word_ordering detection today — "put the
        # words" falls under the same sentence_ordering/ordering rule.
        self.assertEqual(
            classify_task("Put the words in the correct order to make sentences and questions.", "Grammar").question_type,
            "sentence_ordering",
        )

    def test_answer_the_questions(self):
        result = classify_task("Read the text and answer the questions.", "Reading")
        self.assertEqual(result.question_type, "short_answer")

    def test_writing_word_count_range(self):
        result = classify_task("Write 200-220 words.", "Writing")
        self.assertEqual(result.question_type, "writing")
        interaction = infer_interaction("writing", "Write 200-220 words.", "Writing")
        self.assertEqual(interaction["min_words"], 200)
        self.assertEqual(interaction["max_words"], 220)


class InferInteractionTests(unittest.TestCase):
    def test_true_false_maps_to_binary_choice(self):
        self.assertEqual(infer_interaction("true_false", "True or false?", "Reading")["kind"], "binary_choice")

    def test_writing_carries_word_range(self):
        interaction = infer_interaction("writing", "Write an essay of 120-180 words.", "Writing")
        self.assertEqual(interaction["kind"], "long_text")
        self.assertEqual(interaction["min_words"], 120)
        self.assertEqual(interaction["max_words"], 180)

    def test_unknown_type_falls_back_to_default_kind(self):
        interaction = infer_interaction("rich_text_question", "Look at the picture.", "General")
        self.assertEqual(interaction["kind"], "long_text")


if __name__ == "__main__":
    unittest.main()
