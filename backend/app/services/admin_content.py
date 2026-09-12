"""Sections, tasks (exercises), and questions CRUD for the admin content builder."""
import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import AttemptAnswer, MediaAsset, Question, Section, Task, TestVariant
from app.schemas.content import (
    QuestionCreate, QuestionInput, ReorderTasks, SectionInput, TaskCreate,
)
from app.services.admin_media import media_payload
from app.services.audit import write_audit
from app.services.numbering import renumber_questions
from app.services.question_templates import validate_task_payload


def build_task_questions(task_id: uuid.UUID, question_inputs: list[dict]) -> list[Question]:
    """Turn the exercise builder's inline question dicts into Question rows.
    Shared by task create and task edit so both persist identically. Example
    questions are forced to 0 points to satisfy the quality check; their
    answer IS stored — the exam runner shows it to the student as the model
    answer."""
    rows: list[Question] = []
    for question in question_inputs:
        is_example = bool(question.get("is_example"))
        rows.append(Question(
            task_id=task_id,
            prompt=(question.get("prompt") or "").strip(),
            options=question.get("options") or [],
            correct_answer=question.get("correct_answer"),
            accepted_answers=question.get("accepted_answers") or [],
            points=0 if is_example else float(question.get("points") or 1),
            explanation=(question.get("explanation") or None),
            is_example=is_example,
            case_sensitive=bool(question.get("case_sensitive")),
            normalize_spaces=question.get("normalize_spaces", True),
            order_index=question.get("order_index") or 0,
        ))
    return rows


def serialize_question(question: Question) -> dict:
    return {
        "id": question.id, "prompt": question.prompt, "options": question.options,
        "correct_answer": question.correct_answer, "accepted_answers": question.accepted_answers,
        "points": float(question.points), "explanation": question.explanation,
        "is_example": question.is_example, "case_sensitive": question.case_sensitive,
        "normalize_spaces": question.normalize_spaces, "order_index": question.order_index,
    }


async def create_section(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    variant_id: uuid.UUID, payload: SectionInput,
) -> dict:
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    last_order = await db.scalar(
        select(func.max(Section.order_index)).where(Section.test_variant_id == variant_id)
    )
    section = Section(
        test_variant_id=variant_id,
        title=payload.title.strip(),
        order_index=(last_order or 0) + 1,
    )
    db.add(section)
    await db.flush()
    await write_audit(
        db, admin_id, "section.create", "Section", str(section.id),
        {"variant_id": str(variant_id), "title": section.title}, ip_address,
    )
    await db.commit()
    return {"id": section.id, "title": section.title, "order_index": section.order_index, "tasks": []}


async def update_section(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    section_id: uuid.UUID, payload: SectionInput,
) -> dict:
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(404, "Section not found.")
    section.title = payload.title.strip()
    await write_audit(
        db, admin_id, "section.update", "Section", str(section.id), {"title": section.title}, ip_address,
    )
    await db.commit()
    return {"id": section.id, "title": section.title}


async def delete_section(db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, section_id: uuid.UUID) -> None:
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(404, "Section not found.")
    has_answers = await db.scalar(
        select(func.count()).select_from(AttemptAnswer)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .join(Task, Task.id == Question.task_id)
        .where(Task.section_id == section_id)
    )
    if has_answers:
        raise HTTPException(409, "This section has student answers and cannot be deleted.")
    await write_audit(
        db, admin_id, "section.delete", "Section", str(section.id), {"title": section.title}, ip_address,
    )
    await db.delete(section)
    await db.commit()


async def persist_new_task(
    db: AsyncSession, section: Section, payload: TaskCreate, admin_id: uuid.UUID, ip_address: str | None,
) -> dict:
    last_order = await db.scalar(select(func.max(Task.order_index)).where(Task.section_id == section.id))
    values = payload.model_dump()
    interaction = values.pop("interaction", None)
    template_key = values.pop("template_key", None)
    question_inputs = values.pop("questions", []) or []
    if values.get("media_asset_id") and not await db.get(MediaAsset, values["media_asset_id"]):
        raise HTTPException(404, "Media asset not found.")

    # When the exercise builder submits the full structure, reject a variantless
    # or answerless exercise up front so it is never persisted (the fix that
    # prevents the "answer missing / options missing" defects from recurring).
    if template_key:
        problems = validate_task_payload(
            template_key, values["type"], [q.model_dump() for q in payload.questions],
            interaction, values.get("passage_html"),
        )
        if problems:
            raise HTTPException(422, {"message": "Exercise cannot be saved.", "errors": problems})

    task = Task(
        section_id=section.id,
        order_index=(last_order or 0) + 1,
        metadata_json={"interaction": interaction} if interaction else {},
        **values,
    )
    db.add(task)
    await db.flush()

    created_questions = build_task_questions(task.id, question_inputs)
    for question in created_questions:
        db.add(question)
    if created_questions:
        await db.flush()
        renumber_questions(created_questions)

    await write_audit(
        db, admin_id, "task.create", "Task", str(task.id),
        {"section_id": str(section.id), "title": task.title, "type": task.type,
         "questions": len(created_questions)},
        ip_address,
    )
    await db.commit()
    media = await db.get(MediaAsset, task.media_asset_id) if task.media_asset_id else None
    return {
        "id": task.id, "title": task.title, "type": task.type,
        "instructions": task.instructions, "passage_html": task.passage_html,
        "audio_replay_limit": task.audio_replay_limit,
        "interaction": interaction or {}, "media": media_payload(media) if media else None,
        "questions": [serialize_question(q) for q in sorted(created_questions, key=lambda x: x.order_index)],
    }


async def create_task(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    section_id: uuid.UUID, payload: TaskCreate,
) -> dict:
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(404, "Section not found.")
    return await persist_new_task(db, section, payload, admin_id, ip_address)


async def create_task_for_test(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    variant_id: uuid.UUID, payload: TaskCreate,
) -> dict:
    """Add an exercise straight to a test. Sections are an internal grouping the
    admin never sees, so this finds the test's single section (creating one on
    first use) and drops the exercise into it."""
    variant = await db.get(TestVariant, variant_id, options=[selectinload(TestVariant.sections)])
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    section = variant.sections[0] if variant.sections else None
    if not section:
        section = Section(test_variant_id=variant_id, title="Exercises", order_index=1)
        db.add(section)
        await db.flush()
    return await persist_new_task(db, section, payload, admin_id, ip_address)


async def update_task(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    task_id: uuid.UUID, payload: TaskCreate,
) -> dict:
    task = await db.get(Task, task_id, options=[selectinload(Task.questions)])
    if not task:
        raise HTTPException(404, "Task not found.")
    values = payload.model_dump()
    interaction = values.pop("interaction", None)
    template_key = values.pop("template_key", None)
    values.pop("questions", None)
    replace_questions = bool(template_key)
    if values.get("media_asset_id") and not await db.get(MediaAsset, values["media_asset_id"]):
        raise HTTPException(404, "Media asset not found.")

    # When the exercise builder edits the whole exercise it resends every
    # question — validate up front, then swap the question set atomically.
    # Admins can always edit: if students have already answered, the OLD
    # questions are frozen (superseded) rather than deleted/mutated, so their
    # results keep scoring exactly as they did. The edited set becomes the
    # active version everyone gets from their next attempt onward.
    has_answers = False
    if replace_questions:
        problems = validate_task_payload(
            template_key, values["type"], [q.model_dump() for q in payload.questions],
            interaction, values.get("passage_html"),
        )
        if problems:
            raise HTTPException(422, {"message": "Exercise cannot be saved.", "errors": problems})
        has_answers = bool(await db.scalar(
            select(func.count()).select_from(AttemptAnswer)
            .join(Question, Question.id == AttemptAnswer.question_id)
            .where(Question.task_id == task_id)
        ))

    for key, value in values.items():
        setattr(task, key, value)
    if interaction is not None:
        metadata = dict(task.metadata_json or {})
        metadata["interaction"] = interaction
        task.metadata_json = metadata

    new_questions: list[Question] = []
    if replace_questions:
        if has_answers:
            # Freeze, don't touch: an AttemptAnswer FK points at these rows,
            # and their prompt/correct_answer must stay exactly what the
            # student saw and was scored against.
            for existing in task.questions:
                existing.rich_content = {**(existing.rich_content or {}), "superseded": True}
        else:
            for existing in list(task.questions):
                await db.delete(existing)
            await db.flush()
        new_questions = build_task_questions(task.id, [q.model_dump() for q in payload.questions])
        for question in new_questions:
            db.add(question)
        if new_questions:
            await db.flush()
            renumber_questions(new_questions)

    await write_audit(
        db, admin_id, "task.update", "Task", str(task.id),
        {
            "title": task.title, "type": task.type,
            "questions": len(new_questions) if replace_questions else None,
            "superseded_previous_version": has_answers,
        },
        ip_address,
    )
    await db.commit()
    media = await db.get(MediaAsset, task.media_asset_id) if task.media_asset_id else None
    result = {
        "id": task.id, "title": task.title, "type": task.type,
        "instructions": task.instructions, "passage_html": task.passage_html,
        "audio_replay_limit": task.audio_replay_limit,
        "interaction": interaction or {}, "media": media_payload(media) if media else None,
    }
    if replace_questions:
        result["questions"] = [serialize_question(q) for q in sorted(new_questions, key=lambda x: x.order_index)]
    return result


async def delete_task(db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, task_id: uuid.UUID) -> None:
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found.")
    has_answers = await db.scalar(
        select(func.count()).select_from(AttemptAnswer)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .where(Question.task_id == task_id)
    )
    if has_answers:
        raise HTTPException(409, "This task has student answers and cannot be deleted.")
    await write_audit(db, admin_id, "task.delete", "Task", str(task.id), {"title": task.title}, ip_address)
    await db.delete(task)
    await db.commit()


async def duplicate_task(db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, task_id: uuid.UUID) -> dict:
    """Clone an exercise (with all its questions) into the same section — a big
    time-saver when building similar exercises."""
    task = await db.get(Task, task_id, options=[selectinload(Task.questions)])
    if not task:
        raise HTTPException(404, "Task not found.")
    last_order = await db.scalar(select(func.max(Task.order_index)).where(Task.section_id == task.section_id))
    copy = Task(
        section_id=task.section_id,
        type=task.type,
        title=f"{task.title} (copy)",
        instructions=task.instructions,
        passage_html=task.passage_html,
        media_asset_id=task.media_asset_id,
        audio_replay_limit=task.audio_replay_limit,
        order_index=(last_order or 0) + 1,
        metadata_json=dict(task.metadata_json or {}),
    )
    db.add(copy)
    await db.flush()
    new_questions = [
        Question(
            task_id=copy.id, prompt=q.prompt, rich_content=dict(q.rich_content or {}),
            options=list(q.options or []), correct_answer=q.correct_answer,
            accepted_answers=list(q.accepted_answers or []), points=q.points,
            explanation=q.explanation, difficulty=q.difficulty, is_example=q.is_example,
            case_sensitive=q.case_sensitive, normalize_spaces=q.normalize_spaces,
            order_index=q.order_index,
        )
        for q in sorted(task.questions, key=lambda x: x.order_index)
    ]
    for question in new_questions:
        db.add(question)
    if new_questions:
        await db.flush()
        renumber_questions(new_questions)
    await write_audit(
        db, admin_id, "task.duplicate", "Task", str(copy.id), {"source_task": str(task_id)}, ip_address,
    )
    await db.commit()
    return {"id": copy.id, "title": copy.title}


async def reorder_tasks(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    variant_id: uuid.UUID, payload: ReorderTasks,
) -> dict:
    """Persist a new exercise order (from drag-and-drop). Each task's
    order_index becomes its position in the submitted list."""
    variant = await db.get(
        TestVariant, variant_id,
        options=[selectinload(TestVariant.sections).selectinload(Section.tasks)],
    )
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    tasks = {task.id: task for section in variant.sections for task in section.tasks}
    for index, task_id in enumerate(payload.task_ids, start=1):
        task = tasks.get(task_id)
        if task:
            task.order_index = index
    await write_audit(
        db, admin_id, "tasks.reorder", "TestVariant", str(variant_id),
        {"order": [str(tid) for tid in payload.task_ids]}, ip_address,
    )
    await db.commit()
    return {"ok": True}


async def create_question(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    task_id: uuid.UUID, payload: QuestionCreate,
) -> dict:
    task = await db.get(Task, task_id, options=[selectinload(Task.questions)])
    if not task:
        raise HTTPException(404, "Task not found.")
    active = [q for q in task.questions if not (q.rich_content or {}).get("superseded")]
    last_order = max((q.order_index for q in active), default=0)
    question = Question(task_id=task_id, order_index=last_order + 1, **payload.model_dump())
    db.add(question)
    await db.flush()
    renumber_questions([*active, question])
    await write_audit(
        db, admin_id, "question.create", "Question", str(question.id),
        {"task_id": str(task_id), "prompt": question.prompt}, ip_address,
    )
    await db.commit()
    return {
        "id": question.id, **payload.model_dump(mode="json"),
        "order_index": question.order_index,
    }


async def update_question(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    question_id: uuid.UUID, payload: QuestionInput,
) -> dict:
    question = await db.get(Question, question_id)
    if not question:
        raise HTTPException(404, "Question not found.")
    has_answers = await db.scalar(
        select(func.count()).select_from(AttemptAnswer).where(AttemptAnswer.question_id == question_id)
    )
    if has_answers:
        raise HTTPException(409, "This question has student answers; edit the whole exercise instead so the change is versioned safely.")
    for key, value in payload.model_dump().items():
        setattr(question, key, value)
    await write_audit(
        db, admin_id, "question.update", "Question", str(question.id), payload.model_dump(mode="json"), ip_address,
    )
    await db.commit()
    return {"id": question.id}


async def delete_question(db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, question_id: uuid.UUID) -> None:
    question = await db.get(Question, question_id)
    if not question:
        raise HTTPException(404, "Question not found.")
    has_answers = await db.scalar(
        select(func.count()).select_from(AttemptAnswer).where(AttemptAnswer.question_id == question_id)
    )
    if has_answers:
        raise HTTPException(409, "This question has student answers and cannot be deleted.")
    task_id = question.task_id
    await write_audit(
        db, admin_id, "question.delete", "Question", str(question.id), {"prompt": question.prompt}, ip_address,
    )
    await db.delete(question)
    await db.flush()
    remaining = (await db.execute(select(Question).where(Question.task_id == task_id))).scalars().all()
    renumber_questions(list(remaining))
    await db.commit()
