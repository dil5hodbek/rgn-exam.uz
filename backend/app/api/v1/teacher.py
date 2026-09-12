import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_teacher
from app.models import (
    Attempt, AttemptAnswer, AttemptStatus, ExamType, Level, Question, Role, Section, Task, TestVariant, User,
)
from app.schemas.content import GradeInput
from app.services.audit import write_audit

router = APIRouter(prefix="/teacher", tags=["Monitor"])


# How long a graded submission stays visible in the review list after being
# graded — like a notification that's been "read": it lingers briefly so a
# teacher can spot-check their own (or the AI's) recent work, then drops off
# so the list doesn't accumulate every graded answer forever. The underlying
# AttemptAnswer/grade is never deleted — only this list-visibility window.
GRADED_VISIBILITY_HOURS = 24


@router.get("/submissions")
async def writing_submissions(_: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    """Writing/speaking answers that need a human eye, restricted to what a
    student actually submitted (never a blank/skipped answer) and to a
    review-relevant window: every ungraded one, plus graded ones from the
    last GRADED_VISIBILITY_HOURS — older graded answers still exist and
    still count toward the student's score/certificate, they just age out of
    this list. Distinguished by `graded_by`: null means AI (or ungraded), so
    the UI badges "AI graded" vs "Awaiting review" from `is_correct is None`."""
    visibility_cutoff = datetime.now(timezone.utc) - timedelta(hours=GRADED_VISIBILITY_HOURS)
    rows = (await db.execute(
        select(AttemptAnswer, Question, Task, Attempt, User, TestVariant)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .join(Task, Task.id == Question.task_id)
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(User, User.id == Attempt.user_id)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .where(
            Task.type.in_(("writing", "speaking_prompt_placeholder", "rich_text_question")),
            # student_answer can be SQL NULL (never saved) or a stored JSON
            # `null` (saved as empty) — both mean "nothing submitted", so
            # jsonb_typeof must be checked too, not just SQL NULL.
            func.jsonb_typeof(AttemptAnswer.student_answer) != "null",
            (AttemptAnswer.is_correct.is_(None)) | (AttemptAnswer.graded_at >= visibility_cutoff),
        )
        # Sort by when the student actually submitted the attempt (not the
        # answer's last autosave, and never touched by later grading), so the
        # most recently submitted work is always first and every writing
        # answer from the same attempt stays grouped together in the list.
        .order_by(func.coalesce(Attempt.submitted_at, AttemptAnswer.updated_at).desc())
    )).all()
    return [{
        "id": answer.id, "attempt_id": answer.attempt_id, "question_id": answer.question_id,
        "answer": answer.student_answer, "prompt": question.prompt,
        "max_points": float(question.points), "test_title": variant.title,
        "student_name": f"{student.first_name} {student.last_name}",
        "points_awarded": float(answer.points_awarded) if answer.points_awarded is not None else None,
        "feedback": answer.feedback,
        "annotations": (answer.rubric_scores or {}).get("annotations", []),
        # None answer.is_correct = nobody has graded this yet (AI unavailable).
        # graded_by is None but is_correct is set = the AI graded it.
        "status": "awaiting" if answer.is_correct is None else ("ai_graded" if answer.graded_by is None else "teacher_graded"),
        "graded_at": answer.graded_at,
        "submitted_at": attempt.submitted_at or answer.updated_at,
    } for answer, question, task, attempt, student, variant in rows]


@router.post("/attempt-answers/{answer_id}/grade")
async def grade_writing(
    answer_id: uuid.UUID, payload: GradeInput, request: Request,
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
):
    """Same grading logic as the admin fallback-grading endpoint, but reachable
    by teachers too — and usable on an answer the AI already scored, so a
    teacher's correction overwrites the AI's grade rather than only filling
    in ungraded ones."""
    answer = await db.get(AttemptAnswer, answer_id)
    if not answer:
        raise HTTPException(404, "Submission not found.")
    question = await db.get(Question, answer.question_id)
    if not question:
        raise HTTPException(404, "Question not found.")
    if payload.points_awarded > float(question.points):
        raise HTTPException(422, f"Points cannot exceed {float(question.points):g}.")
    previous_points = float(answer.points_awarded or 0)
    answer.points_awarded = payload.points_awarded
    answer.feedback = payload.feedback
    answer.rubric_scores = {
        **payload.rubric_scores,
        "annotations": [a.model_dump() for a in payload.annotations],
    }
    answer.graded_by = teacher.id
    answer.is_correct = payload.points_awarded > 0
    answer.graded_at = datetime.now(timezone.utc)
    attempt = await db.get(Attempt, answer.attempt_id)
    remaining = await db.scalar(select(func.count()).select_from(AttemptAnswer).where(
        AttemptAnswer.attempt_id == answer.attempt_id,
        AttemptAnswer.is_correct.is_(None),
        AttemptAnswer.id != answer.id,
    ))
    attempt.status = AttemptStatus.PENDING_REVIEW if remaining else AttemptStatus.GRADED
    # Re-derive the attempt total from scratch rather than adjusting by the
    # delta — simpler and correct even if this answer was never counted
    # before (first-time grade after AI failure).
    total_score = await db.scalar(
        select(func.coalesce(func.sum(AttemptAnswer.points_awarded), 0))
        .where(AttemptAnswer.attempt_id == answer.attempt_id)
    )
    max_score = await db.scalar(
        select(func.coalesce(func.sum(Question.points), 0))
        .join(Task, Task.id == Question.task_id)
        .join(Section, Section.id == Task.section_id)
        .where(Section.test_variant_id == attempt.test_variant_id, Question.is_example.is_(False))
    )
    attempt.total_score = float(total_score or 0)
    attempt.max_score = float(max_score or 0)
    attempt.percentage = round(float(attempt.total_score) / float(attempt.max_score) * 100, 2) if attempt.max_score else 0
    await write_audit(
        db, teacher.id, "submission.grade", "AttemptAnswer", str(answer.id),
        {**payload.model_dump(), "previous_points": previous_points},
        request.client.host if request.client else None,
    )
    await db.commit()
    return {
        "id": answer.id, "points_awarded": answer.points_awarded,
        "attempt_status": attempt.status, "attempt_percentage": attempt.percentage,
    }


@router.get("/students")
async def teacher_students(search: str = "", _: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    query = select(User).where(User.role == Role.STUDENT)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            User.first_name.ilike(term) | User.last_name.ilike(term) | User.phone_number.ilike(term)
        )
    rows = (await db.execute(query.order_by(User.created_at.desc()).limit(100))).scalars().all()
    if not rows:
        return []
    stats_rows = (await db.execute(
        select(Attempt.user_id, func.count(Attempt.id), func.avg(Attempt.percentage))
        .where(Attempt.user_id.in_([row.id for row in rows]), Attempt.status != AttemptStatus.IN_PROGRESS)
        .group_by(Attempt.user_id)
    )).all()
    stats_map = {user_id: (count, avg) for user_id, count, avg in stats_rows}
    return [{
        "id": row.id, "first_name": row.first_name, "last_name": row.last_name,
        "phone_number": row.phone_number, "is_active": row.is_active,
        "total_attempts": stats_map.get(row.id, (0, None))[0],
        "average_percentage": (
            round(float(stats_map[row.id][1]), 1) if row.id in stats_map and stats_map[row.id][1] is not None else None
        ),
    } for row in rows]


@router.get("/students/{student_id}/attempts")
async def teacher_student_attempts(
    student_id: uuid.UUID, _: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
):
    student = await db.get(User, student_id)
    if not student or student.role != Role.STUDENT:
        raise HTTPException(404, "Student not found.")
    rows = (await db.execute(
        select(Attempt, TestVariant, Level, ExamType)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .join(Level, Level.id == TestVariant.level_id)
        .join(ExamType, ExamType.id == TestVariant.exam_type_id)
        .where(Attempt.user_id == student_id, Attempt.status != AttemptStatus.IN_PROGRESS)
        .order_by(Attempt.submitted_at.desc().nulls_last(), Attempt.started_at.desc())
    )).all()
    return {
        "student": {
            "id": student.id, "first_name": student.first_name, "last_name": student.last_name,
            "phone_number": student.phone_number,
        },
        "attempts": [{
            "id": attempt.id,
            "title": variant.title,
            "level": level.name,
            "exam_type": exam_type.name,
            "is_mixed": bool(attempt.extra_task_ids),
            "status": attempt.status,
            "percentage": float(attempt.percentage) if attempt.percentage is not None else None,
            "passing_percentage": variant.passing_percentage,
            "passed": (
                float(attempt.percentage) >= variant.passing_percentage if attempt.percentage is not None else False
            ),
            "started_at": attempt.started_at,
            "submitted_at": attempt.submitted_at,
            "time_spent_seconds": attempt.time_spent_seconds,
        } for attempt, variant, level, exam_type in rows],
    }
