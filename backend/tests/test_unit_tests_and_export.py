"""Unit tests as a third exam type, the examiner's pass mark, and the Excel
export of a session's results."""
import io

from openpyxl import load_workbook

from app.models import ContentStatus, ExamType, Level, Question, Section, Task, TestVariant
from test_session_time_limit import start_proctored


async def test_exam_types_come_in_course_order(client, db_session):
    from test_attempts_flow import _register_and_login
    level = Level(name="Beginner", slug="beginner", description="", order_index=0)
    db_session.add_all([level, ExamType(name="End Course", slug="end-course"),
                        ExamType(name="Unit Test", slug="unit-test"), ExamType(name="Mid Course", slug="mid-course")])
    await db_session.commit()
    await _register_and_login(client, db=db_session)
    types = (await client.get("/api/v1/levels/beginner/exam-types")).json()
    assert [row["slug"] for row in types] == ["unit-test", "mid-course", "end-course"]


async def test_unit_tests_never_mix_with_course_exams(db_session):
    from app.api.v1.attempts import cross_exam_type_task_ids
    level = Level(name="Beginner", slug="beginner", description="", order_index=0)
    unit, mid = ExamType(name="Unit Test", slug="unit-test"), ExamType(name="Mid Course", slug="mid-course")
    db_session.add_all([level, unit, mid])
    await db_session.flush()
    for exam_type in (unit, mid):
        variant = TestVariant(level_id=level.id, exam_type_id=exam_type.id, title=exam_type.name,
                              variant_number=1, status=ContentStatus.PUBLISHED)
        db_session.add(variant)
        await db_session.flush()
        section = Section(test_variant_id=variant.id, title="S", order_index=0)
        db_session.add(section)
        await db_session.flush()
        task = Task(section_id=section.id, type="multiple_choice", title="T", order_index=0)
        db_session.add(task)
        await db_session.flush()
        db_session.add(Question(task_id=task.id, prompt="A?", options=["A", "B"], correct_answer="A", points=1))
    await db_session.commit()
    # Mid-course has no End-course partner here, and must not borrow the Unit test.
    assert await cross_exam_type_task_ids(db_session, level.id, mid.id, 4) == []
    assert await cross_exam_type_task_ids(db_session, level.id, unit.id, 4) == []


async def test_examiner_pass_mark_drives_the_result(client, db_session):
    examiner, exam, session, attempt_id, _, variant = await start_proctored(client, db_session, passing_percentage=90)
    try:
        assert session["passing_percentage"] == 90
        # The student gets 3 of 4 right: 75% — a pass at the test's 60%, a fail at 90%.
        opened = (await client.post(f"/api/v1/tests/{variant.id}/open?attempt_id={attempt_id}")).json()
        questions = [task["questions"][0]["id"] for section in opened["test"]["sections"] for task in section["tasks"]]
        answers = [{"question_id": qid, "answer": "A" if index < 3 else "B", "flagged": False}
                   for index, qid in enumerate(questions)]
        await client.patch(f"/api/v1/attempts/{attempt_id}/answers", json={"answers": answers})
        await client.post(f"/api/v1/attempts/{attempt_id}/submit")
        result = (await client.get(f"/api/v1/attempts/{attempt_id}/result")).json()
        assert result["passing_percentage"] == 90 and result["passed"] is False

        lowered = await exam.patch(f"/api/v1/examiner/sessions/{session['id']}", json={"passing_percentage": 70})
        assert lowered.status_code == 200
        body = lowered.json()
        assert body["passing_percentage"] == 70 and body["time_limit_minutes"] == 60
        assert body["participants"][0]["passed"] is True
        assert (await client.get(f"/api/v1/attempts/{attempt_id}/result")).json()["passed"] is True
        assert (await exam.patch(f"/api/v1/examiner/sessions/{session['id']}", json={"passing_percentage": 120})).status_code == 422
    finally:
        await examiner.__aexit__(None, None, None)


async def test_default_pass_mark_is_the_tests(client, db_session):
    examiner, exam, session, *_ = await start_proctored(client, db_session)
    try:
        assert session["passing_percentage"] == 60
    finally:
        await examiner.__aexit__(None, None, None)


async def test_export_lists_students_and_scores(client, db_session):
    examiner, exam, session, attempt_id, _, variant = await start_proctored(client, db_session, passing_percentage=50)
    try:
        await client.post(f"/api/v1/attempts/{attempt_id}/submit")
        response = await exam.get(f"/api/v1/examiner/sessions/{session['id']}/export")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/vnd.openxmlformats")
        assert "attachment" in response.headers["content-disposition"]
        sheet = load_workbook(io.BytesIO(response.content)).active
        rows = [[cell.value for cell in row] for row in sheet.iter_rows()]
        header = rows.index(next(row for row in rows if row and row[0] == "№"))
        assert rows[header][1:4] == ["Ism", "Familiya", "Telefon"]
        student = rows[header + 1]
        assert student[0] == 1 and student[8] == "Topshirgan"
        assert student[5] == variant.title and student[11] == 0 and student[12] == "O'tmadi"
        # Students can't download it.
        assert (await client.get(f"/api/v1/examiner/sessions/{session['id']}/export")).status_code in (401, 403)
    finally:
        await examiner.__aexit__(None, None, None)
