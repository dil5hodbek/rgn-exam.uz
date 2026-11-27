"""Examiner-set exam length: 60 minutes by default, chosen when the exam is
created, changeable while students work, and it — not the test's own time
limit — drives every proctored clock."""
from datetime import datetime, timedelta, timezone

from app.models import Attempt
from test_exam_open import seed_exam
from test_exam_sessions import EXAMINER_PHONE, login, make_examiner, register_student, second_client


async def start_proctored(client, db_session, **create):
    """Examiner creates a session, the student joins, is approved, opens and begins."""
    variants = await seed_exam(db_session)
    variant = variants[0]
    variant.time_limit_minutes = 25  # the test's own limit — sessions must not use it
    await db_session.commit()
    await make_examiner(db_session)
    await register_student(client)
    examiner = second_client()
    exam = await examiner.__aenter__()
    await login(exam, EXAMINER_PHONE)
    session = (await exam.post("/api/v1/examiner/sessions",
                               json={"test_variant_id": str(variant.id), **create})).json()
    await client.post("/api/v1/exam-sessions/join", json={"code": session["code"], "test_variant_id": str(variant.id)})
    detail = (await exam.get(f"/api/v1/examiner/sessions/{session['id']}")).json()
    await exam.post(f"/api/v1/examiner/sessions/{session['id']}/participants/{detail['participants'][0]['id']}/approve")
    attempt_id = (await client.post(f"/api/v1/exam-sessions/{session['id']}/start")).json()["attempt_id"]
    opened = (await client.post(f"/api/v1/tests/{variant.id}/open?attempt_id={attempt_id}")).json()
    await client.post(f"/api/v1/attempts/{attempt_id}/begin")
    return examiner, exam, session, attempt_id, opened, variant


async def test_default_length_is_one_hour(client, db_session):
    examiner, exam, session, attempt_id, opened, variant = await start_proctored(client, db_session)
    try:
        assert session["time_limit_minutes"] == 60
        assert opened["test"]["time_limit_minutes"] == 60
        assert opened["attempt"]["time_limit_minutes"] == 60
        beat = (await client.post(f"/api/v1/attempts/{attempt_id}/heartbeat")).json()
        assert beat["time_limit_minutes"] == 60
        assert 59 * 60 <= beat["remaining_seconds"] <= 60 * 60
    finally:
        await examiner.__aexit__(None, None, None)


async def test_length_chosen_at_creation(client, db_session):
    examiner, exam, session, attempt_id, opened, _ = await start_proctored(client, db_session, time_limit_minutes=45)
    try:
        assert session["time_limit_minutes"] == 45
        assert opened["test"]["time_limit_minutes"] == 45
        mine = (await client.get(f"/api/v1/exam-sessions/{session['id']}/me")).json()
        assert mine["time_limit_minutes"] == 45
        listed = (await exam.get("/api/v1/examiner/sessions")).json()
        assert listed[0]["time_limit_minutes"] == 45
        bad = await exam.post("/api/v1/examiner/sessions", json={"test_variant_id": str(session["test_variant_id"]), "time_limit_minutes": 2})
        assert bad.status_code == 422
    finally:
        await examiner.__aexit__(None, None, None)


async def test_examiner_extends_and_shortens_live(client, db_session):
    examiner, exam, session, attempt_id, _, _ = await start_proctored(client, db_session)
    try:
        # The student has worked 20 minutes.
        attempt = await db_session.get(Attempt, attempt_id)
        attempt.started_at = datetime.now(timezone.utc) - timedelta(minutes=20)
        await db_session.commit()

        longer = await exam.patch(f"/api/v1/examiner/sessions/{session['id']}", json={"time_limit_minutes": 75})
        assert longer.status_code == 200
        body = longer.json()
        # At least one minute must stay for the student who has used 20.
        assert body["time_limit_minutes"] == 75 and body["min_time_limit_minutes"] in (21, 22)
        assert 54 * 60 <= body["participants"][0]["remaining_seconds"] <= 55 * 60
        beat = (await client.post(f"/api/v1/attempts/{attempt_id}/heartbeat")).json()
        assert beat["time_limit_minutes"] == 75

        # Cutting below the time already used is refused; just above it is fine.
        too_short = await exam.patch(f"/api/v1/examiner/sessions/{session['id']}", json={"time_limit_minutes": 15})
        assert too_short.status_code == 409
        shorter = await exam.patch(f"/api/v1/examiner/sessions/{session['id']}", json={"time_limit_minutes": 30})
        assert shorter.status_code == 200
        assert 9 * 60 <= shorter.json()["participants"][0]["remaining_seconds"] <= 10 * 60
    finally:
        await examiner.__aexit__(None, None, None)


async def test_time_spent_capped_at_session_length(client, db_session):
    examiner, exam, session, attempt_id, _, _ = await start_proctored(client, db_session, time_limit_minutes=10)
    try:
        attempt = await db_session.get(Attempt, attempt_id)
        attempt.started_at = datetime.now(timezone.utc) - timedelta(minutes=40)
        await db_session.commit()
        submitted = await client.post(f"/api/v1/attempts/{attempt_id}/submit")
        assert submitted.status_code == 200
        await db_session.refresh(attempt)
        assert attempt.time_spent_seconds == 10 * 60
    finally:
        await examiner.__aexit__(None, None, None)
