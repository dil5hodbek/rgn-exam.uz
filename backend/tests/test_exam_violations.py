from app.models import Attempt, AttemptStatus
from test_attempts_flow import _register_and_login
from test_exam_open import seed_exam


async def test_third_exam_mode_violation_submits_with_saved_answers(client, db_session):
    variants = await seed_exam(db_session)
    await _register_and_login(client, db=db_session)
    opened = (await client.post(f"/api/v1/tests/{variants[0].id}/open")).json()
    attempt_id = opened["attempt"]["id"]
    assert opened["attempt"]["violations"] == 0
    assert opened["attempt"]["max_violations"] == 3
    question_id = next(q["id"] for s in opened["test"]["sections"] for t in s["tasks"] for q in t["questions"])
    await client.patch(f"/api/v1/attempts/{attempt_id}/answers",
                       json={"answers": [{"question_id": question_id, "answer": "A", "flagged": False}]})

    first = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "fullscreen"})).json()
    assert first == {"violations": 1, "max_violations": 3, "submitted": False}
    # A refresh keeps the count.
    reopened = (await client.post(f"/api/v1/tests/{variants[0].id}/open?attempt_id={attempt_id}")).json()
    assert reopened["attempt"]["violations"] == 1
    second = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "hidden"})).json()
    assert second["violations"] == 2 and second["submitted"] is False

    third = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "blur"})).json()
    assert third["violations"] == 3 and third["submitted"] is True
    attempt = await db_session.get(Attempt, attempt_id)
    await db_session.refresh(attempt)
    assert attempt.status != AttemptStatus.IN_PROGRESS
    result = (await client.get(f"/api/v1/attempts/{attempt_id}/result")).json()
    assert result["violations"] == 3
    assert result["correct_count"] == 1

    # Further reports after the auto-submit change nothing.
    after = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "blur"})).json()
    assert after["submitted"] is True and after["violations"] == 3


async def test_violation_on_someone_elses_attempt_is_404(client, db_session):
    variants = await seed_exam(db_session)
    await _register_and_login(client, phone="+998901234500", db=db_session)
    attempt_id = (await client.post(f"/api/v1/tests/{variants[0].id}/open")).json()["attempt"]["id"]
    client.cookies.clear()
    await _register_and_login(client, phone="+998901234501", db=db_session)
    response = await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "blur"})
    assert response.status_code == 404
