"""Examiner-proctored sessions: locked tests, session password, approval,
examiner pause/resume, re-entry, grants and username sign-in."""
import asyncio

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.security import hash_password
from app.main import app
from app.models import Role, User
from test_exam_open import seed_exam

STUDENT_PHONE = "+998907770011"
EXAMINER_PHONE = "+998907770022"
PASSWORD = "Passw0rd!"


async def make_examiner(db):
    db.add(User(first_name="Exa", last_name="Miner", phone_number=EXAMINER_PHONE,
                password_hash=hash_password(PASSWORD), role=Role.EXAMINER))
    await db.commit()


async def login(client, identifier, password=PASSWORD):
    response = await client.post("/api/v1/auth/login", json={"phone_number": identifier, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["user"]


async def register_student(client):
    await client.post("/api/v1/auth/register", json={
        "first_name": "Stu", "last_name": "Dent", "phone_number": STUDENT_PHONE,
        "password": PASSWORD, "confirm_password": PASSWORD,
    })
    return await login(client, STUDENT_PHONE)


def second_client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_proctored_session_flow(client, db_session):
    variants = await seed_exam(db_session)
    variant = variants[0]
    await make_examiner(db_session)
    await register_student(client)

    # Locked by default: listing marks it, opening refuses, questions hidden.
    listed = (await client.get("/api/v1/levels/beginner/exam-types/mid-course/variants")).json()
    assert listed[0]["locked"] is True
    blocked = await client.post(f"/api/v1/tests/{variant.id}/open")
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "EXAM_LOCKED"
    assert (await client.get(f"/api/v1/tests/{variant.id}")).status_code == 403
    assert (await client.post("/api/v1/levels/beginner/level-test-attempt")).status_code == 403
    access = (await client.get("/api/v1/levels/beginner/access")).json()
    assert access == {"level_test": False, "exam_types": {"mid-course": False, "end-course": False}}

    async with second_client() as examiner:
        await login(examiner, EXAMINER_PHONE)
        # Students can't use the examiner API.
        assert (await client.get("/api/v1/examiner/sessions")).status_code == 403
        tests = (await examiner.get("/api/v1/examiner/tests")).json()
        assert {row["id"] for row in tests["variants"]} == {str(v.id) for v in variants}
        created = await examiner.post("/api/v1/examiner/sessions", json={"test_variant_id": str(variant.id)})
        assert created.status_code == 201
        session = created.json()
        code, session_id = session["code"], session["id"]
        assert len(code) == 6 and code.isdigit()

        # Wrong password / password of another test.
        assert (await client.post("/api/v1/exam-sessions/join", json={"code": "000000" if code != "000000" else "111111"})).status_code == 404
        wrong_test = await client.post("/api/v1/exam-sessions/join", json={"code": code, "test_variant_id": str(variants[1].id)})
        assert wrong_test.status_code == 400

        joined = await client.post("/api/v1/exam-sessions/join", json={"code": code, "test_variant_id": str(variant.id)})
        assert joined.status_code == 200
        assert joined.json()["status"] == "PENDING"
        assert (await client.post(f"/api/v1/exam-sessions/{session_id}/start")).status_code == 409
        mine = (await client.get("/api/v1/exam-sessions/mine")).json()
        assert [row["session_id"] for row in mine] == [session_id]

        detail = (await examiner.get(f"/api/v1/examiner/sessions/{session_id}")).json()
        participant_id = detail["participants"][0]["id"]
        assert detail["participants"][0]["state"] == "PENDING"
        approved = await examiner.post(f"/api/v1/examiner/sessions/{session_id}/participants/{participant_id}/approve")
        assert approved.json()["participants"][0]["state"] == "APPROVED"

        started = await client.post(f"/api/v1/exam-sessions/{session_id}/start")
        assert started.status_code == 200
        attempt_id = started.json()["attempt_id"]
        # Starting again (e.g. after leaving) returns the same attempt.
        again = await client.post(f"/api/v1/exam-sessions/{session_id}/start")
        assert again.json()["attempt_id"] == attempt_id

        opened = await client.post(f"/api/v1/tests/{variant.id}/open?attempt_id={attempt_id}")
        assert opened.status_code == 200
        state = opened.json()["attempt"]
        assert state["exam_session_id"] == session_id and state["paused"] is False
        question_id = opened.json()["test"]["sections"][0]["tasks"][0]["questions"][0]["id"]
        save = await client.patch(f"/api/v1/attempts/{attempt_id}/answers",
                                  json={"answers": [{"question_id": question_id, "answer": "A", "flagged": False}]})
        assert save.status_code == 200

        live = (await examiner.get(f"/api/v1/examiner/sessions/{session_id}")).json()["participants"][0]
        assert live["state"] == "IN_PROGRESS" and live["online"] is True and live["answered_count"] == 1

        # Student's own leave-pause doesn't stop a proctored clock; restart is refused.
        assert (await client.post(f"/api/v1/attempts/{attempt_id}/pause")).status_code == 204
        assert (await client.post(f"/api/v1/attempts/{attempt_id}/restart")).status_code == 409

        # Examiner pause freezes the clock and blocks saving.
        paused = await examiner.post(f"/api/v1/examiner/sessions/{session_id}/participants/{participant_id}/pause")
        assert paused.json()["participants"][0]["state"] == "PAUSED"
        beat = (await client.post(f"/api/v1/attempts/{attempt_id}/heartbeat")).json()
        assert beat["paused"] is True
        frozen = beat["elapsed_seconds"]
        await asyncio.sleep(1.2)
        assert (await client.post(f"/api/v1/attempts/{attempt_id}/heartbeat")).json()["elapsed_seconds"] == frozen
        blocked_save = await client.patch(f"/api/v1/attempts/{attempt_id}/answers",
                                          json={"answers": [{"question_id": question_id, "answer": "B", "flagged": False}]})
        assert blocked_save.status_code == 423
        assert (await client.post(f"/api/v1/attempts/{attempt_id}/submit")).status_code == 423

        await examiner.post(f"/api/v1/examiner/sessions/{session_id}/resume-all")
        beat = (await client.post(f"/api/v1/attempts/{attempt_id}/heartbeat")).json()
        assert beat["paused"] is False and beat["elapsed_seconds"] <= frozen + 1

        submitted = await client.post(f"/api/v1/attempts/{attempt_id}/submit")
        assert submitted.status_code == 200
        final = (await examiner.get(f"/api/v1/examiner/sessions/{session_id}")).json()["participants"][0]
        assert final["state"] == "SUBMITTED"
        assert (await client.post(f"/api/v1/exam-sessions/{session_id}/start")).status_code == 409
        assert (await client.get("/api/v1/exam-sessions/mine")).json() == []

        # Closing the session stops new joins.
        await examiner.post(f"/api/v1/examiner/sessions/{session_id}/close", json={"submit_in_progress": True})
        assert (await client.post("/api/v1/exam-sessions/join", json={"code": code})).status_code == 404


async def test_remove_participant_locks_attempt(client, db_session):
    variants = await seed_exam(db_session)
    await make_examiner(db_session)
    await register_student(client)
    async with second_client() as examiner:
        await login(examiner, EXAMINER_PHONE)
        session = (await examiner.post("/api/v1/examiner/sessions", json={"test_variant_id": str(variants[0].id)})).json()
        await client.post("/api/v1/exam-sessions/join", json={"code": session["code"]})
        await examiner.post(f"/api/v1/examiner/sessions/{session['id']}/approve-all")
        attempt_id = (await client.post(f"/api/v1/exam-sessions/{session['id']}/start")).json()["attempt_id"]
        participant_id = (await examiner.get(f"/api/v1/examiner/sessions/{session['id']}")).json()["participants"][0]["id"]
        await examiner.post(f"/api/v1/examiner/sessions/{session['id']}/participants/{participant_id}/remove")
        reopened = await client.post(f"/api/v1/tests/{variants[0].id}/open?attempt_id={attempt_id}")
        assert reopened.status_code == 403
        assert (await client.post(f"/api/v1/attempts/{attempt_id}/heartbeat")).json()["removed"] is True
        rejoin = await client.post("/api/v1/exam-sessions/join", json={"code": session["code"]})
        assert rejoin.status_code == 403


async def test_grants_and_username_login(client, db_session):
    variants = await seed_exam(db_session)
    await make_examiner(db_session)
    student = await register_student(client)
    async with second_client() as examiner:
        await login(examiner, EXAMINER_PHONE)
        found = (await examiner.get("/api/v1/examiner/students", params={"q": "7770011"})).json()
        assert found["total"] == 1 and found["items"][0]["id"] == student["id"]

        bad = await examiner.patch(f"/api/v1/examiner/students/{student['id']}", json={"username": "1x"})
        assert bad.status_code == 422
        updated = await examiner.patch(f"/api/v1/examiner/students/{student['id']}", json={"username": "Ali.Valiyev"})
        assert updated.json()["username"] == "ali.valiyev"

        level_id = variants[0].level_id
        granted = await examiner.post(f"/api/v1/examiner/students/{student['id']}/grants",
                                      json={"scope": "LEVEL", "level_id": str(level_id)})
        assert granted.status_code == 201
        grant_id = granted.json()["grants"][0]["id"]
        # Duplicate grant is ignored.
        again = await examiner.post(f"/api/v1/examiner/students/{student['id']}/grants",
                                    json={"scope": "LEVEL", "level_id": str(level_id)})
        assert len(again.json()["grants"]) == 1

        async with second_client() as by_username:
            user = await login(by_username, "ali.valiyev")
            assert user["id"] == student["id"] and user["username"] == "ali.valiyev"
            listed = (await by_username.get("/api/v1/levels/beginner/exam-types/mid-course/variants")).json()
            assert listed[0]["locked"] is False
            assert (await by_username.post(f"/api/v1/tests/{variants[0].id}/open")).status_code == 200
            assert (await by_username.get("/api/v1/levels/beginner/access")).json()["level_test"] is True

        await examiner.delete(f"/api/v1/examiner/grants/{grant_id}")
        listed = (await client.get("/api/v1/levels/beginner/exam-types/mid-course/variants")).json()
        assert listed[0]["locked"] is True

        # Variant-only grant opens that one test but not the pooled tests.
        await examiner.post(f"/api/v1/examiner/students/{student['id']}/grants",
                            json={"scope": "VARIANT", "test_variant_id": str(variants[1].id)})
        end_list = (await client.get("/api/v1/levels/beginner/exam-types/end-course/variants")).json()
        assert end_list[0]["locked"] is False
        assert (await client.post("/api/v1/levels/beginner/exam-types/end-course/random-attempt")).status_code == 403


async def test_admin_creates_examiner(client, db_session):
    db_session.add(User(first_name="Ad", last_name="Min", phone_number="+998907770033",
                        password_hash=hash_password(PASSWORD), role=Role.SUPER_ADMIN))
    await db_session.commit()
    await login(client, "+998907770033")
    created = await client.post("/api/v1/admin/examiners", json={
        "first_name": "New", "last_name": "Examiner", "phone_number": "907770044",
        "username": "examiner1", "password": "secret1",
    })
    assert created.status_code == 201, created.text
    rows = (await client.get("/api/v1/admin/examiners")).json()
    assert rows[0]["username"] == "examiner1"
    user = await db_session.scalar(select(User).where(User.username == "examiner1"))
    assert user.role == Role.EXAMINER
    async with second_client() as examiner:
        assert (await login(examiner, "examiner1", "secret1"))["role"] == "EXAMINER"
        assert (await examiner.get("/api/v1/examiner/sessions")).status_code == 200
        assert (await examiner.get("/api/v1/admin/examiners")).status_code == 403
