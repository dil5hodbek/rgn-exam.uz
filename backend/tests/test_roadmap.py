import unittest
from pathlib import Path

from app.importer.roadmap import AnswerKey, RoadmapDocumentParser, discover_tests, infer_type
from app.importer.roadmap_import import audio_index


class RoadmapImportTests(unittest.TestCase):
    root = (
        Path("/data/source-archive")
        if Path("/data/source-archive").exists()
        else Path(__file__).resolve().parents[2] / "resources" / "source-archive"
    )

    def test_expected_source_inventory(self):
        self.assertEqual(len(discover_tests(self.root)), 26)
        media = [*self.root.rglob("*.mp3"), *self.root.rglob("*.mp4")]
        self.assertEqual(len(media), 49)
        self.assertEqual(len(audio_index(self.root)), 49)

    def test_multiline_answer_key_exercise_is_parsed(self):
        key_path = next(
            path for path in self.root.rglob("*.docx")
            if "answer" in path.name.casefold() and "elem" in path.name.casefold()
        )
        answers = AnswerKey(key_path).for_exercise("mid-course", 1, 1)
        self.assertEqual(answers[2], "work experience")
        self.assertEqual(answers[6], "motivate")

    def test_interactive_listening_metadata_is_parsed(self):
        source = next(path for path in self.root.rglob("Begin End V1.docx"))
        key_path = next(
            path for path in self.root.rglob("*.docx")
            if "answer" in path.name.casefold() and "beginner" in path.name.casefold()
        )
        parsed = RoadmapDocumentParser(AnswerKey(key_path)).parse(
            source, "Beginner", "end-course", 1,
        )
        listening = {
            task.exercise_number: task
            for task in parsed.tasks
            if task.section == "Listening"
        }
        self.assertEqual(listening[1].interaction["kind"], "word_bank")
        self.assertIn("footballers", listening[1].interaction["options"])
        self.assertFalse(listening[1].interaction["reuse_options"])
        self.assertEqual(listening[2].interaction["kind"], "matching")
        self.assertEqual(
            listening[2].interaction["options"],
            [
                {"value": "a", "label": "Richard"},
                {"value": "b", "label": "Jackie"},
                {"value": "c", "label": "both"},
            ],
        )
        self.assertTrue(listening[2].interaction["reuse_options"])
        self.assertEqual(listening[3].interaction["kind"], "inline_alternatives")

    def test_instruction_semantics_override_section_name(self):
        self.assertEqual(
            infer_type("Write true (T), false (F) or no information (N).", "Writing"),
            "true_false_not_given",
        )
        self.assertEqual(
            infer_type("Underline the correct alternatives.", "Writing"),
            "multiple_choice",
        )
        self.assertEqual(
            infer_type("Listen and tick the incorrect answer.", "Listening"),
            "multiple_choice",
        )
        self.assertEqual(
            infer_type("Complete the sentences. The first letter is given.", "Writing"),
            "gap_fill",
        )
        self.assertEqual(
            infer_type("Write an essay of 120–180 words.", "Writing"),
            "writing",
        )

    def test_embedded_cloze_passage_is_split_into_individual_gaps(self):
        source = next(path for path in self.root.rglob("Pre Mid V1.docx"))
        key_path = next(
            path for path in self.root.rglob("*.docx")
            if "answer" in path.name.casefold() and "pre" in path.name.casefold()
        )
        parsed = RoadmapDocumentParser(AnswerKey(key_path)).parse(
            source, "Pre-Intermediate", "mid-course", 1,
        )
        task = next(item for item in parsed.tasks if item.exercise_number == 6)
        self.assertEqual(task.interaction["kind"], "cloze_passage")
        self.assertEqual(len(task.questions), 11)
        self.assertTrue(task.questions[0].is_example)
        self.assertEqual(task.questions[1].correct_answer, "where")
        self.assertEqual(task.questions[-1].correct_answer, "a")
        self.assertIn("{{11}}", task.interaction["template"])

    def test_two_category_matching_labels_are_extracted_generically(self):
        source = next(path for path in self.root.rglob("Inter Mid V1.docx"))
        key_path = next(
            path for path in self.root.rglob("*.docx")
            if "answer" in path.name.casefold() and "inter" in path.name.casefold()
        )
        parsed = RoadmapDocumentParser(AnswerKey(key_path)).parse(
            source, "Intermediate", "mid-course", 1,
        )
        task = next(item for item in parsed.tasks if "sleep" in item.instructions.lower())
        self.assertEqual(task.interaction["kind"], "matching")
        self.assertEqual(
            task.interaction["options"],
            [{"value": "l", "label": "Little sleep"}, {"value": "e", "label": "Enough sleep"}],
        )
        self.assertTrue(task.interaction["reuse_options"])
        self.assertTrue(all(answer in {"l", "e"} for answer in
                             (question.correct_answer for question in task.questions)))

    def test_cloze_passage_with_per_gap_multiple_choice_options(self):
        source = next(path for path in self.root.rglob("Inter End V1.docx"))
        key_path = next(
            path for path in self.root.rglob("*.docx")
            if "answer" in path.name.casefold() and "inter" in path.name.casefold()
        )
        parsed = RoadmapDocumentParser(AnswerKey(key_path)).parse(
            source, "Intermediate", "end-course", 1,
        )
        task = next(item for item in parsed.tasks if "complete the summary" in item.instructions.lower())
        self.assertEqual(task.interaction["kind"], "cloze_passage")
        self.assertTrue(task.interaction.get("per_question_options"))
        by_number = {question.number: question for question in task.questions}
        self.assertEqual(by_number[2].options, ["pollution", "companies", "deforestation"])
        self.assertEqual(by_number[2].correct_answer, "deforestation")
        self.assertEqual(by_number[9].correct_answer, "cooperation")
        self.assertEqual(by_number[10].correct_answer, "individuals")
        # The last gap has no matching answer-key entry and its options line
        # bled into an unrelated trailing passage — must be discarded, not
        # kept as noisy megabyte-long option labels.
        self.assertTrue(all(len(option) <= 40 for option in by_number[11].options))


if __name__ == "__main__":
    unittest.main()
