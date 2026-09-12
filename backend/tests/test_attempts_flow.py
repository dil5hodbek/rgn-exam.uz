"""Router-level smoke test for start -> save answer -> submit.

Requires a reachable Postgres test database and Redis; skips automatically
when neither is available (see conftest.py).
"""
from app.models import ContentStatus, ExamType, Level, Question, Section, Task, TestVariant


async def _register_and_login(client, phone="+998905556677"):
    await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Att",
            "last_name": "Empt",
            "phone_number": phone,
            "password": "Passw0rd!",
            "confirm_password": "Passw0rd!",
        },
    )
    await client.post("/api/v1/auth/login", json={"phone_number": phone, "password": "Passw0rd!"})


async def test_start_save_submit(client, db_session):
    level = Level(name="Elementary", slug="elementary", description="", order_index=0)
    exam_type = ExamType(name="End Course", slug="end-course")
    db_session.add_all([level, exam_type])
    await db_session.flush()

    variant = TestVariant(
        level_id=level.id,
        exam_type_id=exam_type.id,
        title="Elementary End Course #1",
        variant_number=1,
        status=ContentStatus.PUBLISHED,
    )
    db_session.add(variant)
    await db_session.flush()

    section = Section(test_variant_id=variant.id, title="Section 1", order_index=0)
    db_session.add(section)
    await db_session.flush()

    task = Task(section_id=section.id, type="multiple_choice", title="Task 1", order_index=0)
    db_session.add(task)
    await db_session.flush()

    question = Question(
        task_id=task.id, prompt="Pick the correct option", options=["A", "B"],
        correct_answer="A", points=1,
    )
    db_session.add(question)
    await db_session.commit()

    await _register_and_login(client)

    start_resp = await client.post(f"/api/v1/tests/{variant.id}/attempts")
    assert start_resp.status_code == 200
    attempt_id = start_resp.json()["id"]

    save_resp = await client.patch(
        f"/api/v1/attempts/{attempt_id}/answers",
        json={"answers": [{"question_id": str(question.id), "answer": "A", "flagged": False}]},
    )
    assert save_resp.status_code == 200
    assert save_resp.json()["saved"] == 1

    submit_resp = await client.post(f"/api/v1/attempts/{attempt_id}/submit")
    assert submit_resp.status_code == 200
    result = submit_resp.json()
    assert result["status"] == "GRADED"
    assert result["percentage"] == 100.0
