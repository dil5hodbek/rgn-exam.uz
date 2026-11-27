"""Pre-exam briefing (clock starts on "Start"), finished exercises locked,
and right/wrong + the expected answer only in practice — never in an
examiner exam."""
from datetime import datetime, timedelta, timezone

from app.models import Attempt, AttemptAnswer
from sqlalchemy import select
from test_attempts_flow import _register_and_login
from test_exam_open import seed_exam
from test_exam_sessions import EXAMINER_PHONE, login, make_examiner, register_student, second_client


def first_question(opened):
    task = opened["test"]["sections"][0]["tasks"][0]
    return task["id"], task["questions"][0]["id"]


async def test_clock_waits_for_start(client, db_session):
    variants = await seed_exam(db_session)
    await _register_and_login(client, db=db_session)
    opened = (await client.post(f"/api/v1/tests/{variants[0].id}/open")).json()
    attempt_id = opened["attempt"]["id"]
    assert opened["attempt"]["awaiting_start"] is True

    # Sitting on the briefing for half an hour costs nothing.
    attempt = await db_session.get(Attempt, attempt_id)
    attempt.started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    await db_session.commit()
    reopened = (await client.post(f"/api/v1/tests/{variants[0].id}/open?attempt_id={attempt_id}")).json()
    assert reopened["attempt"]["elapsed_seconds"] == 0

    begun = (await client.post(f"/api/v1/attempts/{attempt_id}/begin")).json()
    assert begun["awaiting_start"] is False
    assert begun["elapsed_seconds"] <= 1
    again = await client.post(f"/api/v1/attempts/{attempt_id}/begin")
    assert again.status_code == 200 and again.json()["awaiting_start"] is False


async def test_first_answer_starts_the_clock(client, db_session):
    variants = await seed_exam(db_session)
    await _register_and_login(client, db=db_session)
    opened = (await client.post(f"/api/v1/tests/{variants[0].id}/open")).json()
    attempt_id = opened["attempt"]["id"]
    _, question_id = first_question(opened)
    await client.patch(f"/api/v1/attempts/{attempt_id}/answers",
                       json={"answers": [{"question_id": question_id, "answer": "A", "flagged": False}]})
    attempt = await db_session.get(Attempt, attempt_id)
    await db_session.refresh(attempt)
    assert attempt.awaiting_start is False


async def test_practice_reveals_answer_and_locks_the_exercise(client, db_session):
    variants = await seed_exam(db_session)
    await _register_and_login(client, db=db_session)
    opened = (await client.post(f"/api/v1/tests/{variants[0].id}/open")).json()
    attempt_id = opened["attempt"]["id"]
    task_id, question_id = first_question(opened)
    await client.post(f"/api/v1/attempts/{attempt_id}/begin")
    await client.patch(f"/api/v1/attempts/{attempt_id}/answers",
                       json={"answers": [{"question_id": question_id, "answer": "B", "flagged": False}]})
    checked = (await client.post(f"/api/v1/attempts/{attempt_id}/tasks/{task_id}/check")).json()
    assert checked["results"][0]["is_correct"] is False
    assert checked["results"][0]["correct_answer"] == "A"

    # Changing the answer after finishing the exercise is ignored.
    await client.patch(f"/api/v1/attempts/{attempt_id}/answers",
                       json={"answers": [{"question_id": question_id, "answer": "A", "flagged": False}]})
    stored = await db_session.scalar(select(AttemptAnswer.student_answer).where(
        AttemptAnswer.attempt_id == attempt_id, AttemptAnswer.question_id == question_id))
    assert stored == "B"


async def test_examiner_exam_hides_right_and_wrong(client, db_session):
    variants = await seed_exam(db_session)
    variant = variants[0]
    await make_examiner(db_session)
    await register_student(client)
    async with second_client() as examiner:
        await login(examiner, EXAMINER_PHONE)
        session = (await examiner.post("/api/v1/examiner/sessions", json={"test_variant_id": str(variant.id)})).json()
        await client.post("/api/v1/exam-sessions/join", json={"code": session["code"], "test_variant_id": str(variant.id)})
        detail = (await examiner.get(f"/api/v1/examiner/sessions/{session['id']}")).json()
        participant_id = detail["participants"][0]["id"]
        await examiner.post(f"/api/v1/examiner/sessions/{session['id']}/participants/{participant_id}/approve")
    attempt_id = (await client.post(f"/api/v1/exam-sessions/{session['id']}/start")).json()["attempt_id"]
    opened = (await client.post(f"/api/v1/tests/{variant.id}/open?attempt_id={attempt_id}")).json()
    assert opened["attempt"]["awaiting_start"] is True
    task_id, question_id = first_question(opened)
    await client.post(f"/api/v1/attempts/{attempt_id}/begin")
    await client.patch(f"/api/v1/attempts/{attempt_id}/answers",
                       json={"answers": [{"question_id": question_id, "answer": "B", "flagged": False}]})
    checked = (await client.post(f"/api/v1/attempts/{attempt_id}/tasks/{task_id}/check")).json()
    assert checked["results"][0]["is_correct"] is None
    assert checked["results"][0]["correct_answer"] is None
