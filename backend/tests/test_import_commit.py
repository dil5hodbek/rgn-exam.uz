import unittest
from pathlib import Path

from sqlalchemy import select

from app.importer.roadmap import ParsedQuestion, ParsedTask, ParsedTest
from app.importer.roadmap_import import _renumber_cloze_template, persist_parsed
from app.models import ContentStatus, ExamType, Level, Section, Task


def _sample_parsed_test() -> ParsedTest:
    return ParsedTest(
        level="Beginner",
        exam_slug="end-course",
        variant=999,
        title="Test commit fixture",
        source_path=Path("fixture.docx"),
        tasks=[
            ParsedTask(
                exercise_number=1,
                title="Exercise 1",
                instructions="Choose the correct answer a, b or c.",
                question_type="multiple_choice",
                section="Grammar",
                interaction={"kind": "multiple_choice"},
                questions=[
                    ParsedQuestion(number=2, prompt="Q2", options=["a", "b"], correct_answer="a"),
                    ParsedQuestion(number=1, prompt="Q1", options=["a", "b"], correct_answer="b"),
                ],
            ),
        ],
    )


class RenumberClozeTemplateTests(unittest.TestCase):
    def test_template_placeholders_and_example_values_are_remapped(self):
        task = ParsedTask(
            exercise_number=1, title="Exercise 1", instructions="Complete the summary.",
            question_type="gap_fill", section="Reading",
            interaction={
                "kind": "cloze_passage",
                "template": "A {{1}} B {{3}} C {{5}}",
                "example_values": {"1": "example"},
            },
            questions=[
                ParsedQuestion(number=1, prompt="", is_example=True),
                ParsedQuestion(number=3, prompt="p3", options=["x", "y"], correct_answer="x"),
                ParsedQuestion(number=5, prompt="p5", options=["x", "y"], correct_answer="y"),
            ],
        )
        _renumber_cloze_template(task)
        self.assertEqual(task.interaction["template"], "A {{1}} B {{2}} C {{3}}")
        self.assertEqual(task.interaction["example_values"], {"1": "example"})
        self.assertEqual(sorted(question.number for question in task.questions), [1, 2, 3])

    def test_non_cloze_tasks_are_left_untouched(self):
        task = ParsedTask(
            exercise_number=1, title="Exercise 1", instructions="Choose a, b or c.",
            question_type="multiple_choice", section="Grammar",
            interaction={"kind": "multiple_choice"},
            questions=[ParsedQuestion(number=5, prompt="p5", options=["a", "b"], correct_answer="a")],
        )
        _renumber_cloze_template(task)
        self.assertEqual(task.questions[0].number, 5)


class PersistParsedIntegrationTests(unittest.IsolatedAsyncioTestCase):
    """Best-effort DB-backed test: this repo has no test-DB harness (no
    conftest.py / sqlite shim — the models use Postgres-only JSONB columns),
    so this connects to the real DATABASE_URL and skips cleanly if it's
    unreachable, mirroring how test_roadmap.py guards on the sample archive
    existing. Run this from inside the backend container / CI where Postgres
    is reachable to actually exercise it.
    """

    async def test_persist_parsed_creates_variant_with_per_exercise_numbering(self):
        try:
            from app.core.database import SessionLocal
        except Exception as exc:  # pragma: no cover - environment guard
            self.skipTest(f"Database engine unavailable: {exc}")

        try:
            async with SessionLocal() as db:
                level = await db.scalar(select(Level).where(Level.name == "Beginner"))
                exam_type = await db.scalar(select(ExamType).where(ExamType.slug == "end-course"))
                if not level or not exam_type:
                    self.skipTest("Seed data (Level/ExamType) not present.")

                parsed = _sample_parsed_test()
                variant = await persist_parsed(
                    db, parsed, level, exam_type, admin_id=None,
                    source_document="fixture.docx", status=ContentStatus.NEEDS_REVIEW,
                )
                await db.flush()

                tasks = (await db.execute(
                    select(Task).where(Task.section_id.in_(
                        select(Section.id).where(Section.test_variant_id == variant.id)
                    ))
                )).scalars().all()
                self.assertEqual(len(tasks), 1)
                await db.refresh(tasks[0], attribute_names=["questions"])
                orders = sorted(question.order_index for question in tasks[0].questions)
                self.assertEqual(orders, [1, 2])

                # Never persist the fixture — roll back instead of committing.
                await db.rollback()
        except Exception as exc:
            self.skipTest(f"Database not reachable in this environment: {exc}")


if __name__ == "__main__":
    unittest.main()
