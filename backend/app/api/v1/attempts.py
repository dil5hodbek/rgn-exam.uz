import asyncio
import random
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from redis.asyncio import Redis
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.core.deps import current_user
from app.models import (
    Attempt, AttemptAnswer, AttemptStatus, ContentStatus, ExamType, Level, MediaAsset, Question, Section,
    Task, TestVariant, User,
)
from app.schemas.content import AnswerBatch
from app.services.ai_grading import ai_grade_text
from app.services.exercise_registry import MANUAL_TASK_TYPES
from app.services.certificate import generate_certificate_pdf
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
        # When the server copy was last written — the client compares this
        # against its local backup so an older device never overwrites newer work.
        "answers_updated_at": max((row.updated_at for row in rows), default=None),
        "answers": [{
            "question_id": row.question_id,
            "answer": row.student_answer,
            "flagged": row.flagged,
        } for row in rows],
        "checked_task_ids": list(checked_task_ids),
        # Exercise order shuffled once at attempt creation (see
        # shuffled_task_order) — the client reorders its rendered exercise list
        # to match instead of the raw Task.order_index from GET /tests/{id}.
        "task_order": attempt.task_order,
    }


EXTRA_SECTION_TITLE = "Bonus exercises"


async def attempt_sections(db: AsyncSession, attempt: Attempt) -> list[Section]:
    """The full set of Sections this attempt draws questions from: the primary
    TestVariant's own sections, plus (for a mixed random test) one synthetic,
    unpersisted Section wrapping whichever Tasks were borrowed from the other
    exam type — see start_random_attempt. Every endpoint that used to walk
    `variant.sections` walks this instead, so mixed attempts fall out for
    free without duplicating the section/task/question loop everywhere."""
    variant = await db.scalar(
        select(TestVariant)
        .where(TestVariant.id == attempt.test_variant_id)
        .options(
            selectinload(TestVariant.sections)
            .selectinload(Section.tasks)
            .selectinload(Task.questions)
        )
    )
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    sections = list(variant.sections)
    if attempt.primary_task_ids is not None:
        # Level test: only a ~50% slice of the primary variant's own tasks is
        # in play — drop the rest from each section (keep the section itself,
        # even if it ends up empty, so the count/grouping stays predictable).
        keep = set(attempt.primary_task_ids)
        narrowed = []
        for section in sections:
            filtered = Section(id=section.id, title=section.title, order_index=section.order_index)
            filtered.tasks = [task for task in section.tasks if str(task.id) in keep]
            narrowed.append(filtered)
        sections = narrowed
    if attempt.extra_task_ids:
        extra_tasks = (await db.execute(
            select(Task).where(Task.id.in_(attempt.extra_task_ids))
            .options(selectinload(Task.questions))
        )).scalars().all()
        if extra_tasks:
            bonus_section = Section(id=uuid.uuid4(), title=EXTRA_SECTION_TITLE, order_index=len(sections))
            bonus_section.tasks = list(extra_tasks)
            sections.append(bonus_section)
    return sections


async def attempt_variant(db: AsyncSession, attempt: Attempt) -> TestVariant:
    variant = await db.get(TestVariant, attempt.test_variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    return variant


async def shuffled_task_order(
    db: AsyncSession, test_id: uuid.UUID,
    extra_task_ids: list[str] | None = None, primary_task_ids: list[str] | None = None,
) -> list[str]:
    """Shuffle exercises (Tasks) within each Section independently, so the
    section grouping students see stays intact but the order of exercises
    inside it is randomized once per attempt. Question order within a Task
    is never touched. Extra (cross-exam-type) tasks form their own shuffled
    group, appended after the primary variant's own sections. When
    primary_task_ids is given, only those of the primary variant's tasks are
    included (a "level test" 50/50 mix) instead of every task."""
    sections = (await db.execute(
        select(Section).where(Section.test_variant_id == test_id).order_by(Section.order_index)
        .options(selectinload(Section.tasks))
    )).scalars().all()
    keep = set(primary_task_ids) if primary_task_ids is not None else None
    order: list[str] = []
    for section in sections:
        task_ids = [str(task.id) for task in section.tasks if keep is None or str(task.id) in keep]
        random.shuffle(task_ids)
        order.extend(task_ids)
    if extra_task_ids:
        bonus_ids = list(extra_task_ids)
        random.shuffle(bonus_ids)
        order.extend(bonus_ids)
    return order


async def create_attempt(
    db: AsyncSession, user_id: uuid.UUID, variant: TestVariant,
    extra_task_ids: list[str] | None = None, primary_task_ids: list[str] | None = None,
) -> Attempt:
    is_level_test = primary_task_ids is not None
    existing = await db.scalar(select(Attempt).where(
        Attempt.user_id == user_id, Attempt.test_variant_id == variant.id,
        Attempt.status == AttemptStatus.IN_PROGRESS,
        Attempt.primary_task_ids.isnot(None) if is_level_test else Attempt.primary_task_ids.is_(None),
    ))
    if existing:
        # Resume a paused attempt: the clock stopped at "Save & exit", so
        # shift started_at to keep exactly the remaining time from that moment.
        redis = redis_client()
        try:
            paused = await redis.get(f"attempt-paused:{existing.id}")
            if paused is not None:
                existing.started_at = datetime.now(timezone.utc) - timedelta(seconds=float(paused))
                await db.commit()
                await redis.delete(f"attempt-paused:{existing.id}")
        finally:
            await redis.aclose()
        return existing
    completed = await db.scalar(select(Attempt.id).where(
        Attempt.user_id == user_id,
        Attempt.test_variant_id == variant.id,
        Attempt.status != AttemptStatus.IN_PROGRESS,
    ).limit(1))
    if completed and not variant.retake_allowed:
        raise HTTPException(409, "Retaking this test is not allowed.")
    task_order = await shuffled_task_order(db, variant.id, extra_task_ids, primary_task_ids)
    attempt = Attempt(
        user_id=user_id, test_variant_id=variant.id, task_order=task_order,
        extra_task_ids=extra_task_ids, primary_task_ids=primary_task_ids,
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return attempt


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
    attempt = await create_attempt(db, user.id, variant)
    return await attempt_state(db, attempt)


# The fraction of a random test's exercises pulled from the OTHER exam type
# at the same level (e.g. a Mid-course random test is 75% Mid-course + 25%
# End-course exercises), per the product decision to mix study material
# across the mid/end split rather than serve either type in isolation.
CROSS_EXAM_TYPE_SHARE = 0.25


async def cross_exam_type_task_ids(
    db: AsyncSession, level_id: uuid.UUID, primary_exam_type_id: uuid.UUID, primary_task_count: int,
) -> list[str]:
    """Picks a random published variant of the OTHER exam type at this level
    and returns a random ~25%-of-primary-count sample of its Task IDs across
    all its sections, flattened (no per-section grouping needed here — they
    land in one bonus section, see attempt_sections). Empty if this level has
    no variant of the other exam type at all — the test then stays 100%
    primary-type with no error, per product decision."""
    other_variant_ids = (await db.execute(
        select(TestVariant.id).where(
            TestVariant.level_id == level_id,
            TestVariant.exam_type_id != primary_exam_type_id,
            TestVariant.status == ContentStatus.PUBLISHED,
        )
    )).scalars().all()
    if not other_variant_ids:
        return []
    other_variant_id = random.choice(other_variant_ids)
    other_task_ids = (await db.execute(
        select(Task.id).join(Section, Section.id == Task.section_id)
        .where(Section.test_variant_id == other_variant_id)
    )).scalars().all()
    if not other_task_ids:
        return []
    sample_size = max(1, round(primary_task_count * CROSS_EXAM_TYPE_SHARE))
    sample_size = min(sample_size, len(other_task_ids))
    return [str(task_id) for task_id in random.sample(other_task_ids, sample_size)]


@router.post("/levels/{level_slug}/exam-types/{type_slug}/random-attempt")
async def start_random_attempt(
    level_slug: str, type_slug: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db),
):
    """Picks one published variant at random for this level+exam type and
    starts (or resumes) an attempt on it — the student never sees or chooses
    the variant number. The attempt is topped up with a slice of exercises
    borrowed from the other exam type at the same level (see
    cross_exam_type_task_ids) so a Mid-course random test also touches
    End-course material, and vice versa."""
    row = (await db.execute(
        select(TestVariant.id, TestVariant.level_id, TestVariant.exam_type_id)
        .join(Level, TestVariant.level_id == Level.id)
        .join(ExamType, TestVariant.exam_type_id == ExamType.id)
        .where(Level.slug == level_slug, ExamType.slug == type_slug, TestVariant.status == ContentStatus.PUBLISHED)
    )).all()
    if not row:
        raise HTTPException(404, "No published test is available for this level yet.")
    variant_id, level_id, exam_type_id = random.choice(row)
    variant = await db.get(TestVariant, variant_id)
    primary_task_count = await db.scalar(
        select(func.count(Task.id)).join(Section, Section.id == Task.section_id)
        .where(Section.test_variant_id == variant.id)
    )
    extra_task_ids = await cross_exam_type_task_ids(db, level_id, exam_type_id, primary_task_count or 0)
    attempt = await create_attempt(db, user.id, variant, extra_task_ids or None)
    return {"test_variant_id": variant.id, **(await attempt_state(db, attempt))}


# A "Level Test" isn't tied to Mid- vs End-course at all — it draws roughly
# half its exercises from each, unlike the 75/25 exam-type-specific random
# test above.
LEVEL_TEST_SHARE = 0.5


@router.post("/levels/{level_slug}/level-test-attempt")
async def start_level_test_attempt(
    level_slug: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db),
):
    """A level-wide test: picks one random published Mid-course variant (the
    "primary" — its time limit and passing percentage govern the attempt)
    and one random published End-course variant at this level, then mixes
    roughly half of each side's exercises into a single attempt. If the
    level has only one exam type published, falls back to that type alone
    rather than erroring — same no-error-on-missing-content policy as
    start_random_attempt."""
    mid_course_rows = (await db.execute(
        select(TestVariant.id, TestVariant.level_id, TestVariant.exam_type_id)
        .join(Level, TestVariant.level_id == Level.id)
        .join(ExamType, TestVariant.exam_type_id == ExamType.id)
        .where(Level.slug == level_slug, ExamType.slug == "mid-course", TestVariant.status == ContentStatus.PUBLISHED)
    )).all()
    end_course_rows = (await db.execute(
        select(TestVariant.id, TestVariant.level_id, TestVariant.exam_type_id)
        .join(Level, TestVariant.level_id == Level.id)
        .join(ExamType, TestVariant.exam_type_id == ExamType.id)
        .where(Level.slug == level_slug, ExamType.slug == "end-course", TestVariant.status == ContentStatus.PUBLISHED)
    )).all()
    if not mid_course_rows and not end_course_rows:
        raise HTTPException(404, "No published test is available for this level yet.")
    # Prefer Mid-course as the primary (time limit / passing %) when both
    # exist; otherwise whichever type is actually available carries it.
    primary_rows = mid_course_rows or end_course_rows
    other_rows = end_course_rows if primary_rows is mid_course_rows else []
    primary_variant_id, level_id, _primary_exam_type_id = random.choice(primary_rows)
    variant = await db.get(TestVariant, primary_variant_id)

    primary_task_ids_all = (await db.execute(
        select(Task.id).join(Section, Section.id == Task.section_id)
        .where(Section.test_variant_id == variant.id)
    )).scalars().all()
    other_task_ids_all: list[uuid.UUID] = []
    if other_rows:
        other_variant_id, _, _ = random.choice(other_rows)
        other_task_ids_all = list((await db.execute(
            select(Task.id).join(Section, Section.id == Task.section_id)
            .where(Section.test_variant_id == other_variant_id)
        )).scalars().all())

    if other_task_ids_all:
        primary_sample_size = max(1, round(len(primary_task_ids_all) * LEVEL_TEST_SHARE))
        other_sample_size = max(1, round(len(other_task_ids_all) * LEVEL_TEST_SHARE))
        primary_task_ids = [
            str(task_id) for task_id in random.sample(primary_task_ids_all, min(primary_sample_size, len(primary_task_ids_all)))
        ]
        extra_task_ids = [
            str(task_id) for task_id in random.sample(other_task_ids_all, min(other_sample_size, len(other_task_ids_all)))
        ]
    else:
        # Only one exam type published at this level — the whole test is
        # that type, no narrowing.
        primary_task_ids = None
        extra_task_ids = []

    attempt = await create_attempt(db, user.id, variant, extra_task_ids or None, primary_task_ids)
    primary_exam_type_slug = "mid-course" if primary_rows is mid_course_rows else "end-course"
    return {
        "test_variant_id": variant.id, "exam_type_slug": primary_exam_type_slug,
        **(await attempt_state(db, attempt)),
    }


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


@router.post("/attempts/{attempt_id}/pause", status_code=204)
async def pause_attempt(attempt_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """'Save & exit': freeze the timer at this moment. The elapsed time is
    stored; when the student comes back, the clock resumes from here."""
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "This attempt has already been submitted.")
    started_at = attempt.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    elapsed = max(0.0, (datetime.now(timezone.utc) - started_at).total_seconds())
    redis = redis_client()
    try:
        await redis.set(f"attempt-paused:{attempt.id}", elapsed, ex=settings.refresh_token_days * 86400)
    finally:
        await redis.aclose()


@router.get("/me/teacher-reviews")
async def my_teacher_reviews(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The student's teacher-graded work (writing/speaking): pending items
    waiting for the teacher plus graded ones with score, feedback and the
    teacher's marked errors."""
    manual_types = ("writing", "speaking_prompt_placeholder", "rich_text_question")
    rows = (await db.execute(
        select(AttemptAnswer, Question, Task, Attempt, TestVariant)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .join(Task, Task.id == Question.task_id)
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .where(
            Attempt.user_id == user.id,
            Attempt.status != AttemptStatus.IN_PROGRESS,
            Task.type.in_(manual_types),
            func.jsonb_typeof(AttemptAnswer.student_answer) != "null",
        )
        .order_by(func.coalesce(Attempt.submitted_at, AttemptAnswer.updated_at).desc())
    )).all()
    return [{
        "id": answer.id,
        "attempt_id": answer.attempt_id,
        "test_title": variant.title,
        "task_title": task.title,
        "instructions": task.instructions,
        "prompt": question.prompt,
        "answer": answer.student_answer,
        "max_points": float(question.points),
        "graded": answer.graded_at is not None,
        "points_awarded": float(answer.points_awarded) if answer.points_awarded is not None else None,
        "feedback": answer.feedback,
        "annotations": (answer.rubric_scores or {}).get("annotations", []),
        "graded_at": answer.graded_at,
        "submitted_at": attempt.submitted_at,
    } for answer, question, task, attempt, variant in rows]


@router.post("/attempts/{attempt_id}/restart", status_code=204)
async def restart_attempt(attempt_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Wipe the attempt clean and start over: every saved answer is deleted,
    all finished-exercise locks are lifted, and the timer restarts from the
    full time limit."""
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "This attempt has already been submitted.")
    await db.execute(delete(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id))
    attempt.started_at = datetime.now(timezone.utc)
    await db.commit()
    redis = redis_client()
    try:
        await redis.delete(f"attempt-checked:{attempt.id}")
    finally:
        await redis.aclose()


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
        .where(
            (Section.test_variant_id == attempt.test_variant_id)
            | (Task.id.in_(attempt.extra_task_ids or []))
        )
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
        .where(
            Task.id == task_id,
            (Section.test_variant_id == attempt.test_variant_id) | (Task.id.in_(attempt.extra_task_ids or [])),
        )
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
    variant = await attempt_variant(db, attempt)
    sections = await attempt_sections(db, attempt)
    total = 0.0
    maximum = 0.0
    pending = False
    # AI-graded (writing/speaking) answers are collected here instead of being
    # awaited one at a time — a test with several such questions used to pay
    # their OpenRouter latency sequentially (multiplying submit time by the
    # question count). They're fired concurrently after this loop instead.
    ai_jobs: list[tuple[AttemptAnswer, Task, Question]] = []
    for section in sections:
        for task in section.tasks:
            task_superseded = (task.metadata_json or {}).get("superseded")
            for question in task.questions:
                # An exercise/question edited out from under an in-progress
                # attempt is skipped for everyone EXCEPT a student who already
                # has an answer recorded against it — their in-flight work
                # still gets fairly scored on the frozen pre-edit question.
                question_superseded = (question.rich_content or {}).get("superseded")
                if (task_superseded or question_superseded) and question.id not in answer_map:
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
                # Open writing/speaking answers are graded by the AI — queued
                # here and run concurrently below (no teacher hand-off).
                # Auto-gradable types keep the fast path.
                if task.type in MANUAL_TASK_TYPES:
                    ai_jobs.append((answer, task, question))
                    continue
                result = grade_answer(
                    task.type, answer.student_answer, question.correct_answer, question.accepted_answers,
                    float(question.points), question.case_sensitive, question.normalize_spaces,
                )
                answer.is_correct, answer.points_awarded = result.is_correct, result.points
                pending = pending or result.needs_review
                total += float(result.points or 0)

    if ai_jobs:
        verdicts = await asyncio.gather(*(
            ai_grade_text(
                task.instructions or "", question.prompt or "",
                str(answer.student_answer or ""), float(question.points),
                ((task.metadata_json or {}).get("interaction") or {}).get("min_words"),
                ((task.metadata_json or {}).get("interaction") or {}).get("max_words"),
            )
            for answer, task, question in ai_jobs
        ))
        for (answer, _task, _question), verdict in zip(ai_jobs, verdicts):
            if verdict is not None:
                score, feedback = verdict
                answer.points_awarded = score
                answer.is_correct = score > 0
                answer.feedback = feedback
                answer.graded_at = datetime.now(timezone.utc)
                answer.graded_by = None  # AI, not a human reviewer
                total += score
            else:
                # AI unavailable — fall back to human review so the answer is
                # never silently zeroed.
                answer.is_correct, answer.points_awarded = None, None
                pending = True
    attempt.total_score, attempt.max_score = total, maximum
    attempt.percentage = round(total / maximum * 100, 2) if maximum else 0
    attempt.submitted_at = datetime.now(timezone.utc)
    started_at = attempt.started_at if attempt.started_at.tzinfo else attempt.started_at.replace(tzinfo=timezone.utc)
    elapsed = int((attempt.submitted_at - started_at).total_seconds())
    # Cap at the test's time limit so an attempt left open for hours (then submitted
    # or auto-submitted) doesn't record runaway practice time.
    attempt.time_spent_seconds = max(0, min(elapsed, variant.time_limit_minutes * 60))
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


@router.get("/me/saved-questions")
async def saved_questions(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Every question the student bookmarked (flagged) during their attempts,
    newest first — the "Saved questions" review list."""
    rows = (await db.execute(
        select(AttemptAnswer, Question, Task, TestVariant, Level, ExamType)
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .join(Task, Task.id == Question.task_id)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .join(Level, Level.id == TestVariant.level_id)
        .join(ExamType, ExamType.id == TestVariant.exam_type_id)
        .where(Attempt.user_id == user.id, AttemptAnswer.flagged.is_(True))
        .order_by(AttemptAnswer.updated_at.desc())
    )).all()
    return [{
        "id": answer.id,
        "attempt_id": answer.attempt_id,
        "question_id": question.id,
        "prompt": question.prompt,
        "options": question.options,
        "correct_answer": question.correct_answer if variant.review_allowed else None,
        "student_answer": answer.student_answer,
        "is_correct": answer.is_correct,
        "exercise_type": task.type,
        "test_title": variant.title,
        "level": level.name,
        "exam_type": exam_type.name,
    } for answer, question, task, variant, level, exam_type in rows]


@router.get("/attempts/{attempt_id}/result")
async def attempt_result(
    attempt_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status == AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "Submit the test before viewing results.")
    variant = await attempt_variant(db, attempt)
    attempt_secs = await attempt_sections(db, attempt)
    saved = (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id)
    )).scalars().all()
    answer_map = {row.question_id: row for row in saved}
    media_ids = {
        task.media_asset_id
        for section in attempt_secs for task in section.tasks
        if task.media_asset_id
    }
    media_map = {}
    if media_ids:
        media_rows = (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(media_ids)))).scalars().all()
        media_map = {
            media.id: {"id": media.id, "file_name": media.file_name, "url": media.file_url, "mime_type": media.mime_type}
            for media in media_rows
        }
    section_summaries = []
    review = []
    correct_count = incorrect_count = pending_count = 0
    for section in attempt_secs:
        earned = maximum = 0.0
        for task in section.tasks:
            for question in task.questions:
                # This endpoint only ever serves a completed attempt (checked
                # above), and submit() already wrote exactly one AttemptAnswer
                # per question that was active at submission time — including
                # unanswered ones. So membership here IS the historical
                # snapshot: it naturally excludes anything the admin added
                # afterward, and naturally keeps whatever the student actually
                # saw, even if that exercise/question is superseded by now.
                if question.id not in answer_map:
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
                        "task_id": task.id,
                        "section": section.title,
                        "task_type": task.type,
                        "task_title": task.title,
                        "passage_html": task.passage_html,
                        "media": media_map.get(task.media_asset_id),
                        "prompt": question.prompt,
                        "student_answer": answer.student_answer if answer else None,
                        "correct_answer": question.correct_answer,
                        "is_correct": answer.is_correct if answer else False,
                        "points_awarded": float(answer.points_awarded or 0) if answer else 0,
                        "explanation": question.explanation,
                        "feedback": answer.feedback if answer else None,
                    })
        section_summaries.append({
            "title": section.title,
            "score": earned,
            "max_score": maximum,
            "percentage": round(earned / maximum * 100, 2) if maximum else 0,
        })
    return {
        "id": attempt.id,
        "test_variant_id": variant.id,
        "title": variant.title,
        "status": attempt.status,
        "score": float(attempt.total_score or 0),
        "max_score": float(attempt.max_score or 0),
        "percentage": float(attempt.percentage or 0),
        "passing_percentage": variant.passing_percentage,
        "passed": float(attempt.percentage or 0) >= variant.passing_percentage,
        "retake_allowed": variant.retake_allowed,
        "correct_count": correct_count,
        "incorrect_count": incorrect_count,
        "pending_count": pending_count,
        "time_spent_seconds": attempt.time_spent_seconds or 0,
        "sections": section_summaries,
        "review": review,
    }


@router.get("/attempts/{attempt_id}/certificate")
async def attempt_certificate(
    attempt_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await owned_attempt(db, attempt_id, user.id)
    if attempt.status != AttemptStatus.GRADED:
        raise HTTPException(409, "The certificate is available once grading is complete.")
    row = (await db.execute(
        select(TestVariant, Level, ExamType)
        .join(Level, TestVariant.level_id == Level.id)
        .join(ExamType, TestVariant.exam_type_id == ExamType.id)
        .where(TestVariant.id == attempt.test_variant_id)
    )).first()
    if not row:
        raise HTTPException(404, "Test variant not found.")
    variant, level, exam_type = row
    percentage = float(attempt.percentage or 0)
    if percentage < variant.passing_percentage:
        raise HTTPException(403, "Certificate is only available for passing attempts.")

    pdf_bytes = generate_certificate_pdf(
        full_name=f"{user.first_name} {user.last_name}",
        phone_number=user.phone_number,
        level_name=level.name,
        exam_type_name=exam_type.name,
        percentage=percentage,
    )
    filename = f"certificate-{attempt.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
