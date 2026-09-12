"""Router-level smoke test for the catalog listing + test detail endpoints.

Requires a reachable Postgres test database and Redis; skips automatically
when neither is available (see conftest.py).
"""
from app.models import ContentStatus, ExamType, Level, Question, Section, Task, TestVariant


async def _register_and_login(client, phone="+998901112233"):
    await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Cat",
            "last_name": "Alog",
            "phone_number": phone,
            "password": "Passw0rd!",
            "confirm_password": "Passw0rd!",
        },
    )
    await client.post("/api/v1/auth/login", json={"phone_number": phone, "password": "Passw0rd!"})


async def test_levels_and_test_detail(client, db_session):
    level = Level(name="Beginner", slug="beginner", description="", order_index=0)
    exam_type = ExamType(name="Mid Course", slug="mid-course")
    db_session.add_all([level, exam_type])
    await db_session.flush()

    variant = TestVariant(
        level_id=level.id,
        exam_type_id=exam_type.id,
        title="Beginner Mid Course #1",
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

    question = Question(task_id=task.id, prompt="2 + 2 = ?", options=["3", "4"], correct_answer="4")
    db_session.add(question)
    await db_session.commit()

    await _register_and_login(client)

    levels_resp = await client.get("/api/v1/catalog/levels")
    assert levels_resp.status_code == 200
    assert any(row["slug"] == "beginner" for row in levels_resp.json())

    detail_resp = await client.get(f"/api/v1/catalog/tests/{variant.id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["title"] == "Beginner Mid Course #1"
    assert len(detail["sections"]) == 1
    assert len(detail["sections"][0]["tasks"]) == 1
