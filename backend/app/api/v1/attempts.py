import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.core.deps import current_user
from app.models import (
    Attempt, AttemptAnswer, AttemptStatus, ContentStatus, ExamType, Level, Question, Section, Task,
    TestVariant, User,
)
from app.schemas.content import AnswerBatch
from app.services.grading import grade_answer

router = APIRouter(tags=["Attempts"])


def redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


async def attempt_state(db: AsyncSession, attempt: Attempt) -> dict:
    rows = (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id)
    )).scalars().all()
    started_at = attempt.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    redis = redis_client()
    try:
        checked_task_ids = await redis.smembers(f"attempt-checked:{attempt.id}")
    finally:
        await redis.aclose()
    return {
        "id": attempt.id,
        "status": attempt.status,
        "started_at": attempt.started_at,
        "elapsed_seconds": max(0, int((datetime.now(timezone.utc) - started_at).total_seconds())),
        "answers": [{
            "question_id": row.question_id,
            "answer": row.student_answer,
            "flagged": row.flagged,
        } for row in rows],
        "checked_task_ids": list(checked_task_ids),
    }


@router.post("/tests/{test_id}/attempts")
async def start_attempt(test_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    variant = await db.scalar(
        select(TestVariant).where(
            TestVariant.id == test_id,
            TestVariant.status == ContentStatus.PUBLISHED,
        )
    )
    if not variant:
        raise HTTPException(404, "Published test not found.")
    existing = await db.scalar(select(Attempt).where(
        Attempt.user_id == user.id, Attempt.test_variant_id == test_id,
        Attempt.status == AttemptStatus.IN_PROGRESS,
    ))
    if existing:
        return await attempt_state(db, existing)
    completed = await db.scalar(select(Attempt.id).where(
        Attempt.user_id == user.id,
        Attempt.test_variant_id == test_id,
        Attempt.status != AttemptStatus.IN_PROGRESS,
    ).limit(1))
    if completed and not variant.retake_allowed:
        raise HTTPException(409, "Retaking this test is not allowed.")
    attempt = Attempt(user_id=user.id, test_variant_id=test_id)
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return await attempt_state(db, attempt)


async def owned_attempt(db: AsyncSession, attempt_id: uuid.UUID, user_id: uuid.UUID) -> Attempt:
    attempt = await db.scalar(select(Attempt).where(Attempt.id == attempt_id, Attempt.user_id == user_id))
    if not attempt:
        raise HTTPException(404, "Attempt not found.")
    return attempt


async def ensure_attempt_time(db: AsyncSession, attempt: Attempt) -> None:
    limit = await db.scalar(
        select(TestVariant.time_limit_minutes).where(TestVariant.id == attempt.test_variant_id)
    )
    started_at = attempt.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
    if limit and elapsed >= limit * 60:
        raise HTTPException(409, "The test time has expired. Submit the saved answers.")


@router.patch("/attempts/{attempt_id}/answers")
async def save_answers(attempt_id: uuid.UUID, payload: AnswerBatch, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "This attempt has already been submitted.")
    await ensure_attempt_time(db, attempt)
    allowed_question_ids = set((await db.execute(
        select(Question.id)
        .join(Task, Task.id == Question.task_id)
        .join(Section, Section.id == Task.section_id)
        .where(Section.test_variant_id == attempt.test_variant_id)
    )).scalars())
    submitted = {item.question_id: item for item in payload.answers}
    invalid_ids = set(submitted) - allowed_question_ids
    if invalid_ids:
        raise HTTPException(422, "One or more answers do not belong to this test.")
    for item in submitted.values():
        answer = await db.scalar(select(AttemptAnswer).where(
            AttemptAnswer.attempt_id == attempt.id, AttemptAnswer.question_id == item.question_id
        ))
        if answer:
            answer.student_answer, answer.flagged, answer.updated_at = item.answer, item.flagged, datetime.now(timezone.utc)
        else:
            db.add(AttemptAnswer(attempt_id=attempt.id, question_id=item.question_id, student_answer=item.answer, flagged=item.flagged))
    await db.commit()
    return {"saved": len(submitted), "saved_at": datetime.now(timezone.utc)}


@router.post("/attempts/{attempt_id}/tasks/{task_id}/check")
async def check_exercise(
    attempt_id: uuid.UUID,
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "This attempt has already been submitted.")
    await ensure_attempt_time(db, attempt)
    task = await db.scalar(
        select(Task)
        .join(Section, Section.id == Task.section_id)
        .where(Task.id == task_id, Section.test_variant_id == attempt.test_variant_id)
        .options(selectinload(Task.questions))
    )
    if not task:
        raise HTTPException(404, "Exercise not found in this test.")
    if (task.metadata_json or {}).get("superseded"):
        raise HTTPException(409, "This exercise has been replaced by a corrected version.")
    active_questions = [
        question for question in task.questions
        if not (question.rich_content or {}).get("superseded")
    ]
    saved = (await db.execute(
        select(AttemptAnswer).where(
            AttemptAnswer.attempt_id == attempt.id,
            AttemptAnswer.question_id.in_([question.id for question in active_questions]),
        )
    )).scalars().all()
    answer_map = {row.question_id: row.student_answer for row in saved}
    results = []
    for question in active_questions:
        if question.is_example:
            results.append({"question_id": question.id, "is_correct": True, "is_example": True})
            continue
        student_answer = answer_map.get(question.id)
        if student_answer in (None, "", []):
            is_correct = False
        else:
            grade = grade_answer(
                task.type, student_answer, question.correct_answer, question.accepted_answers,
                float(question.points), question.case_sensitive, question.normalize_spaces,
            )
            is_correct = grade.is_correct
        results.append({
            "question_id": question.id,
            "is_correct": is_correct,
            "is_example": False,
        })
    redis = redis_client()
    checked_key = f"attempt-checked:{attempt.id}"
    try:
        await redis.sadd(checked_key, str(task.id))
        await redis.expire(checked_key, settings.refresh_token_days * 86400)
    finally:
        await redis.aclose()
    return {"task_id": task.id, "results": results, "checked": True}


@router.delete("/attempts/{attempt_id}/tasks/{task_id}/check", status_code=204)
async def clear_exercise_check(
    attempt_id: uuid.UUID,
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "This attempt has already been submitted.")
    redis = redis_client()
    try:
        await redis.srem(f"attempt-checked:{attempt.id}", str(task_id))
    finally:
        await redis.aclose()


@router.post("/attempts/{attempt_id}/submit")
async def submit(attempt_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "This attempt has already been submitted.")
    saved_answers = (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id)
    )).scalars().all()
    answer_map = {row.question_id: row for row in saved_answers}
    variant = await db.scalar(
        select(TestVariant)
        .where(TestVariant.id == attempt.test_variant_id)
        .options(
            selectinload(TestVariant.sections)
            .selectinload(Section.tasks)
            .selectinload(Task.questions)
        )
    )
    total = 0.0
    maximum = 0.0
    pending = False
    for section in variant.sections:
        for task in section.tasks:
            if (task.metadata_json or {}).get("superseded"):
                continue
            for question in task.questions:
                if (question.rich_content or {}).get("superseded"):
                    continue
                if not question.is_example:
                    maximum += float(question.points)
                answer = answer_map.get(question.id)
                if not answer:
                    answer = AttemptAnswer(
                        attempt_id=attempt.id,
                        question_id=question.id,
                        student_answer=None,
                        flagged=False,
                    )
                    db.add(answer)
                if question.is_example:
                    answer.is_correct, answer.points_awarded = True, 0
                    continue
                if answer.student_answer in (None, "", []):
                    answer.is_correct, answer.points_awarded = False, 0
                    continue
                result = grade_answer(
                    task.type, answer.student_answer, question.correct_answer, question.accepted_answers,
                    float(question.points), question.case_sensitive, question.normalize_spaces,
                )
                answer.is_correct, answer.points_awarded = result.is_correct, result.points
                pending = pending or result.needs_review
                total += float(result.points or 0)
    attempt.total_score, attempt.max_score = total, maximum
    attempt.percentage = round(total / maximum * 100, 2) if maximum else 0
    attempt.submitted_at = datetime.now(timezone.utc)
    attempt.time_spent_seconds = int((attempt.submitted_at - attempt.started_at).total_seconds())
    attempt.status = AttemptStatus.PENDING_REVIEW if pending else AttemptStatus.GRADED
    await db.commit()
    return {"status": attempt.status, "score": total, "max_score": maximum, "percentage": attempt.percentage}


@router.get("/me/attempts")
async def history(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Attempt, TestVariant, Level, ExamType)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .join(Level, Level.id == TestVariant.level_id)
        .join(ExamType, ExamType.id == TestVariant.exam_type_id)
        .where(Attempt.user_id == user.id)
        .order_by(Attempt.started_at.desc())
    )).all()
    return [{
        "id": attempt.id, "test_variant_id": attempt.test_variant_id, "status": attempt.status,
        "score": float(attempt.total_score or 0), "max_score": float(attempt.max_score or 0),
        "percentage": float(attempt.percentage or 0),
        "started_at": attempt.started_at, "submitted_at": attempt.submitted_at,
        "time_spent_seconds": attempt.time_spent_seconds or 0,
        "title": variant.title, "variant_number": variant.variant_number,
        "level": level.name, "level_slug": level.slug,
        "exam_type": exam_type.name, "exam_type_slug": exam_type.slug,
    } for attempt, variant, level, exam_type in rows]


@router.get("/attempts/{attempt_id}/result")
async def attempt_result(
    attempt_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status == AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "Submit the test before viewing results.")
    variant = await db.scalar(
        select(TestVariant)
        .where(TestVariant.id == attempt.test_variant_id)
        .options(
            selectinload(TestVariant.sections)
            .selectinload(Section.tasks)
            .selectinload(Task.questions)
        )
    )
    saved = (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id)
    )).scalars().all()
    answer_map = {row.question_id: row for row in saved}
    sections = []
    review = []
    correct_count = incorrect_count = pending_count = 0
    for section in variant.sections:
        earned = maximum = 0.0
        for task in section.tasks:
            if (task.metadata_json or {}).get("superseded"):
                continue
            for question in task.questions:
                if (question.rich_content or {}).get("superseded"):
                    continue
                if question.is_example:
                    continue
                maximum += float(question.points)
                answer = answer_map.get(question.id)
                earned += float(answer.points_awarded or 0) if answer else 0
                if answer and answer.is_correct is True:
                    correct_count += 1
                elif answer and answer.is_correct is False:
                    incorrect_count += 1
                else:
                    pending_count += 1
                if variant.review_allowed:
                    review.append({
                        "question_id": question.id,
                        "section": section.title,
                        "task_type": task.type,
                        "prompt": question.prompt,
                        "student_answer": answer.student_answer if answer else None,
                        "correct_answer": question.correct_answer,
                        "is_correct": answer.is_correct if answer else False,
                        "points_awarded": float(answer.points_awarded or 0) if answer else 0,
                        "explanation": question.explanation,
                        "feedback": answer.feedback if answer else None,
                    })
        sections.append({
            "title": section.title,
            "score": earned,
            "max_score": maximum,
            "percentage": round(earned / maximum * 100, 2) if maximum else 0,
        })
    return {
        "id": attempt.id,
        "title": variant.title,
        "status": attempt.status,
        "score": float(attempt.total_score or 0),
        "max_score": float(attempt.max_score or 0),
        "percentage": float(attempt.percentage or 0),
        "passing_percentage": variant.passing_percentage,
        "passed": float(attempt.percentage or 0) >= variant.passing_percentage,
        "correct_count": correct_count,
        "incorrect_count": incorrect_count,
        "pending_count": pending_count,
        "time_spent_seconds": attempt.time_spent_seconds or 0,
        "sections": sections,
        "review": review,
    }
