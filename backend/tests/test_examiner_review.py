"""Examiner results/writing review and the per-student exam-mode switch."""
from app.core.security import hash_password
from app.models import Question, Role, Section, Task, User
from sqlalchemy import select
from test_exam_open import seed_exam
from test_exam_sessions import EXAMINER_PHONE, PASSWORD, login, make_examiner, register_student, second_client


async def add_writing_task(db, variant):
    section = await db.scalar(select(Section).where(Section.test_variant_id == variant.id))
    task = Task(section_id=section.id, type="writing", title="Essay", instructions="Write about your day.", order_index=9)
    db.add(task)
    await db.flush()
    db.add(Question(task_id=task.id, prompt="Describe your morning.", options=[], correct_answer=None, points=5))
    await db.commit()


async def test_examiner_sees_answers_ai_writing_grade_and_exam_mode(client, db_session, monkeypatch):
    async def fake_ai(*_args, **_kwargs):
        return 3.0, "Clear ideas, a few grammar mistakes."
    monkeypatch.setattr("app.api.v1.attempts.ai_grade_text", fake_ai)

    variants = await seed_exam(db_session)
    variant = variants[0]
    await add_writing_task(db_session, variant)
    await make_examiner(db_session)
    student = await register_student(client)

    async with second_client() as examiner:
        await login(examiner, EXAMINER_PHONE)
        session_id = (await examiner.post("/api/v1/examiner/sessions", json={"test_variant_id": str(variant.id)})).json()["id"]
        code = (await examiner.get(f"/api/v1/examiner/sessions/{session_id}")).json()["code"]
        await client.post("/api/v1/exam-sessions/join", json={"code": code, "test_variant_id": str(variant.id)})
        participant_id = (await examiner.get(f"/api/v1/examiner/sessions/{session_id}")).json()["participants"][0]["id"]
        await examiner.post(f"/api/v1/examiner/sessions/{session_id}/participants/{participant_id}/approve")
        attempt_id = (await client.post(f"/api/v1/exam-sessions/{session_id}/start")).json()["attempt_id"]
        opened = (await client.post(f"/api/v1/tests/{variant.id}/open?attempt_id={attempt_id}")).json()
        assert opened["attempt"]["exam_mode"] is True

        # Examiner switches exam mode off for this student: picked up live,
        # and leaving no longer counts.
        switched = await examiner.patch(f"/api/v1/examiner/students/{student['id']}", json={"exam_mode": False})
        assert switched.status_code == 200 and switched.json()["exam_mode"] is False
        assert (await client.post(f"/api/v1/attempts/{attempt_id}/heartbeat")).json()["exam_mode"] is False
        ignored = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "blur"})).json()
        assert ignored["violations"] == 0
        await examiner.patch(f"/api/v1/examiner/students/{student['id']}", json={"exam_mode": True})
        counted = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "blur"})).json()
        assert counted["violations"] == 1
        live = (await examiner.get(f"/api/v1/examiner/sessions/{session_id}")).json()["participants"][0]
        assert live["violations"] == 1 and live["exam_mode"] is True

        questions = {q["prompt"]: q["id"] for s in opened["test"]["sections"] for t in s["tasks"] for q in t["questions"]}
        writing_id = questions["Describe your morning."]
        choice_id = next(qid for prompt, qid in questions.items() if prompt == "Choose A")
        await client.patch(f"/api/v1/attempts/{attempt_id}/answers", json={"answers": [
            {"question_id": choice_id, "answer": "A", "flagged": False},
            {"question_id": writing_id, "answer": "I woke up early and went to school.", "flagged": False},
        ]})
        assert (await client.post(f"/api/v1/attempts/{attempt_id}/submit")).status_code == 200

        listed = (await examiner.get("/api/v1/examiner/sessions")).json()[0]
        assert listed["writing_total"] == 1 and listed["writing_awaiting"] == 0

        results = (await examiner.get(f"/api/v1/examiner/sessions/{session_id}/results")).json()
        row = results["students"][0]
        assert row["attempt_id"] == attempt_id
        # The AI-scored writing counts as correct too, as on the student result page.
        assert row["correct"] == 2 and row["writing_total"] == 1 and row["writing_ai"] == 1
        assert row["writing_points"] == 3.0 and row["writing_max"] == 5.0 and row["violations"] == 1

        review = (await examiner.get(f"/api/v1/examiner/attempts/{attempt_id}/review")).json()
        items = {q["prompt"]: q for s in review["sections"] for t in s["tasks"] for q in t["questions"]}
        essay = items["Describe your morning."]
        assert essay["status"] == "ai_graded" and essay["points_awarded"] == 3.0
        assert essay["feedback"].startswith("Clear ideas") and essay["correct_answer"] is None
        answered = [q for prompt, q in items.items() if prompt == "Choose A" and q["student_answer"] == "A"]
        assert answered and answered[0]["is_correct"] is True and answered[0]["correct_answer"] == "A"
        assert review["violations"] == 1 and review["student"]["first_name"] == "Stu"

        # A teacher's later correction shows up as teacher-graded.
        db_session.add(User(first_name="Tea", last_name="Cher", phone_number="+998907770099",
                            password_hash=hash_password(PASSWORD), role=Role.TEACHER))
        await db_session.commit()
        async with second_client() as teacher:
            await login(teacher, "+998907770099")
            essay_answer_id = next(row["id"] for row in (await teacher.get("/api/v1/teacher/submissions")).json()
                                   if row["attempt_id"] == attempt_id)
            graded = await teacher.post(f"/api/v1/teacher/attempt-answers/{essay_answer_id}/grade",
                                        json={"points_awarded": 4, "feedback": "Good work.", "rubric_scores": {}, "annotations": []})
            assert graded.status_code == 200, graded.text
        review = (await examiner.get(f"/api/v1/examiner/attempts/{attempt_id}/review")).json()
        essay = next(q for s in review["sections"] for t in s["tasks"] for q in t["questions"] if q["prompt"] == "Describe your morning.")
        assert essay["status"] == "teacher_graded" and essay["points_awarded"] == 4.0
        assert essay["graded_by_name"] == "Tea Cher"

    # Another examiner cannot open this examiner's results.
    db_session.add(User(first_name="Other", last_name="Ex", phone_number="+998907770033",
                        password_hash=hash_password(PASSWORD), role=Role.EXAMINER))
    await db_session.commit()
    async with second_client() as other:
        await login(other, "+998907770033")
        assert (await other.get(f"/api/v1/examiner/attempts/{attempt_id}/review")).status_code == 404
        assert (await other.get(f"/api/v1/examiner/sessions/{session_id}/results")).status_code == 404
