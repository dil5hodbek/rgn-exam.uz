from sqlalchemy import func, select

from app.models import Attempt, AttemptStatus, ContentStatus, ExamType, Level, Question, Section, Task, TestVariant
from app.api.v1.attempts import redis_client
from test_attempts_flow import _register_and_login


async def seed_exam(db):
    level = Level(name="Beginner", slug="beginner", description="Practice", order_index=0)
    mid = ExamType(name="Mid Course", slug="mid-course")
    end = ExamType(name="End Course", slug="end-course")
    db.add_all([level, mid, end])
    await db.flush()
    variants = []
    for exam_type in [mid, end]:
        variant = TestVariant(level_id=level.id, exam_type_id=exam_type.id, title=exam_type.name,
                              variant_number=1, status=ContentStatus.PUBLISHED)
        db.add(variant)
        await db.flush()
        section = Section(test_variant_id=variant.id, title=exam_type.name, order_index=0)
        db.add(section)
        await db.flush()
        for index in range(4):
            task = Task(section_id=section.id, type="multiple_choice", title=f"Task {index + 1}", order_index=index)
            db.add(task)
            await db.flush()
            db.add(Question(task_id=task.id, prompt="Choose A", options=["A", "B"], correct_answer="A", points=1))
        variants.append(variant)
    await db.commit()
    return variants


def task_ids(test):
    return {task["id"] for section in test["sections"] for task in section["tasks"]}


async def test_open_returns_state_and_questions_without_answer_keys(client, db_session):
    variants = await seed_exam(db_session)
    assert (await client.post(f"/api/v1/tests/{variants[0].id}/open")).status_code == 401
    await _register_and_login(client)
    response = await client.post(f"/api/v1/tests/{variants[0].id}/open")
    assert response.status_code == 200
    data = response.json()
    assert data["test"]["id"] == str(variants[0].id)
    assert task_ids(data["test"]) == set(data["attempt"]["task_order"])
    assert len(task_ids(data["test"])) == 4
    for section in data["test"]["sections"]:
        for task in section["tasks"]:
            for question in task["questions"]:
                assert "correct_answer" not in question
                assert question["example_answer"] is None
    repeated = await client.post(f"/api/v1/tests/{variants[0].id}/open")
    assert repeated.json()["attempt"]["id"] == data["attempt"]["id"]


async def test_level_open_preserves_exact_mix_answers_and_paused_time(client, db_session):
    await seed_exam(db_session)
    await _register_and_login(client)
    started = (await client.post("/api/v1/levels/beginner/level-test-attempt")).json()
    path = f"/api/v1/tests/{started['test_variant_id']}/open?attempt_id={started['id']}"
    opened = await client.post(path)
    assert opened.status_code == 200
    data = opened.json()
    assert data["attempt"]["id"] == started["id"]
    assert data["attempt"]["task_order"] == started["task_order"]
    assert task_ids(data["test"]) == set(started["task_order"])
    assert len(task_ids(data["test"])) == 4
    assert len([section for section in data["test"]["sections"] if section["tasks"]]) == 2
    question_id = next(q["id"] for s in data["test"]["sections"] for t in s["tasks"] for q in t["questions"])
    await client.patch(f"/api/v1/attempts/{started['id']}/answers", json={"answers": [{"question_id": question_id, "answer": "A", "flagged": True}]})
    redis = redis_client()
    try:
        await redis.set(f"attempt-paused:{started['id']}", "123", ex=60)
        resumed = (await client.post(path)).json()["attempt"]
        assert 123 <= resumed["elapsed_seconds"] <= 126
        assert resumed["answers"][0]["answer"] == "A"
        assert resumed["answers"][0]["flagged"] is True
        assert await redis.get(f"attempt-paused:{started['id']}") is None
    finally:
        await redis.aclose()
    assert await db_session.scalar(select(func.count()).select_from(Attempt)) == 1


async def test_open_rejects_other_user_mismatch_and_submitted_attempt(client, db_session):
    variants = await seed_exam(db_session)
    await _register_and_login(client)
    state = (await client.post(f"/api/v1/tests/{variants[0].id}/open")).json()["attempt"]
    path = f"/api/v1/tests/{variants[0].id}/open?attempt_id={state['id']}"
    mismatch = await client.post(f"/api/v1/tests/{variants[1].id}/open?attempt_id={state['id']}")
    assert mismatch.status_code == 404
    from uuid import UUID
    attempt = await db_session.get(Attempt, UUID(state["id"]))
    attempt.status = AttemptStatus.GRADED
    await db_session.commit()
    assert (await client.post(path)).status_code == 409
    await client.post("/api/v1/auth/logout")
    await _register_and_login(client, phone="+998905556688")
    assert (await client.post(path)).status_code == 404


async def test_random_open_keeps_bonus_exercises(client, db_session):
    await seed_exam(db_session)
    await _register_and_login(client)
    started = (await client.post("/api/v1/levels/beginner/exam-types/mid-course/random-attempt")).json()
    opened = await client.post(f"/api/v1/tests/{started['test_variant_id']}/open?attempt_id={started['id']}")
    assert opened.status_code == 200
    assert task_ids(opened.json()["test"]) == set(started["task_order"])
    assert len(task_ids(opened.json()["test"])) == 5
