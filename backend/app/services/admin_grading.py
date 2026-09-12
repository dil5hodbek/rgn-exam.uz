import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attempt, AttemptAnswer, AttemptStatus, Question, Section, Task, TestVariant, User
from app.schemas.content import GradeInput
from app.services.audit import write_audit


async def pending_submissions(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(AttemptAnswer, Question, Attempt, User, TestVariant)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(User, User.id == Attempt.user_id)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .where(AttemptAnswer.is_correct.is_(None))
        .order_by(AttemptAnswer.updated_at)
    )).all()
    return [{
        "id": answer.id, "attempt_id": answer.attempt_id, "question_id": answer.question_id,
        "answer": answer.student_answer, "prompt": question.prompt,
        "max_points": float(question.points), "test_title": variant.title,
        "student_name": f"{student.first_name} {student.last_name}",
    } for answer, question, attempt, student, variant in rows]


async def grade_submission(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    answer_id: uuid.UUID, payload: GradeInput,
) -> dict:
    answer = await db.get(AttemptAnswer, answer_id)
    if not answer:
        raise HTTPException(404, "Submission not found.")
    question = await db.get(Question, answer.question_id)
    if not question:
        raise HTTPException(404, "Question not found.")
    if payload.points_awarded > float(question.points):
        raise HTTPException(422, f"Points cannot exceed {float(question.points):g}.")
    answer.points_awarded = payload.points_awarded
    answer.feedback = payload.feedback
    # Marked errors ride along in the rubric JSON so no migration is needed;
    # the student's review page renders them as highlights.
    answer.rubric_scores = {
        **payload.rubric_scores,
        "annotations": [a.model_dump() for a in payload.annotations],
    }
    answer.graded_by = admin_id
    answer.is_correct = payload.points_awarded > 0
    answer.graded_at = datetime.now(timezone.utc)
    attempt = await db.get(Attempt, answer.attempt_id)
    remaining = await db.scalar(select(func.count()).select_from(AttemptAnswer).where(
        AttemptAnswer.attempt_id == answer.attempt_id,
        AttemptAnswer.is_correct.is_(None),
        AttemptAnswer.id != answer.id,
    ))
    attempt.status = AttemptStatus.PENDING_REVIEW if remaining else AttemptStatus.GRADED
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
        db, admin_id, "submission.grade", "AttemptAnswer", str(answer.id), payload.model_dump(), ip_address,
    )
    await db.commit()
    return {
        "id": answer.id, "points_awarded": answer.points_awarded,
        "attempt_status": attempt.status, "attempt_percentage": attempt.percentage,
    }
