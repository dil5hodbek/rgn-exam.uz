"""TestVariant CRUD, publish/unpublish, and the destructive full-content reset."""
import uuid

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import verify_password
from app.models import Attempt, ContentStatus, ExamType, Level, Section, Task, TestVariant, User
from app.schemas.content import ResetContent, VariantCreate, VariantUpdate
from app.services.audit import write_audit
from app.services.media import batch_media_by_ids
from app.services.quality import quality_report


async def list_tests(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(TestVariant, Level, ExamType)
        .join(Level, Level.id == TestVariant.level_id)
        .join(ExamType, ExamType.id == TestVariant.exam_type_id)
        .options(
            selectinload(TestVariant.sections)
            .selectinload(Section.tasks)
            .selectinload(Task.questions)
        )
        .order_by(Level.order_index, ExamType.name, TestVariant.variant_number)
    )).all()
    return [{
        "id": variant.id, "title": variant.title, "variant_number": variant.variant_number,
        "level": level.name, "level_slug": level.slug,
        "exam_type": exam_type.name, "exam_type_slug": exam_type.slug,
        "status": variant.status, "time_limit_minutes": variant.time_limit_minutes,
        "sections_count": len(variant.sections),
        "tasks_count": sum(
            1 for section in variant.sections for task in section.tasks
            if not (task.metadata_json or {}).get("superseded")
        ),
        "questions_count": sum(
            1 for section in variant.sections for task in section.tasks
            if not (task.metadata_json or {}).get("superseded")
            for question in task.questions
            if not (question.rich_content or {}).get("superseded")
        ),
    } for variant, level, exam_type in rows]


async def admin_test_detail(db: AsyncSession, variant_id: uuid.UUID) -> dict:
    variant = await db.scalar(
        select(TestVariant)
        .where(TestVariant.id == variant_id)
        .options(
            selectinload(TestVariant.sections)
            .selectinload(Section.tasks)
            .selectinload(Task.questions)
        )
    )
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    level, exam_type = await db.get(Level, variant.level_id), await db.get(ExamType, variant.exam_type_id)
    media_ids = {
        task.media_asset_id
        for section in variant.sections for task in section.tasks
        if task.media_asset_id
    }
    media_map = await batch_media_by_ids(db, media_ids)
    sections = []
    for section in variant.sections:
        tasks = []
        for task in section.tasks:
            # Superseded tasks are retired copies kept only because students
            # already answered them — invisible everywhere in the admin UI.
            if (task.metadata_json or {}).get("superseded"):
                continue
            media = media_map.get(task.media_asset_id) if task.media_asset_id else None
            tasks.append({
                "id": task.id, "title": task.title, "type": task.type,
                "order_index": task.order_index,
                "instructions": task.instructions, "passage_html": task.passage_html,
                "audio_replay_limit": task.audio_replay_limit,
                "interaction": (task.metadata_json or {}).get("interaction", {}),
                "media": ({
                    "id": media.id, "file_name": media.file_name, "url": media.file_url,
                    "mime_type": media.mime_type,
                } if media else None),
                "questions": [{
                    "id": question.id, "prompt": question.prompt, "options": question.options,
                    "correct_answer": question.correct_answer, "accepted_answers": question.accepted_answers,
                    "points": float(question.points), "explanation": question.explanation,
                    "is_example": question.is_example, "case_sensitive": question.case_sensitive,
                    "normalize_spaces": question.normalize_spaces,
                    "order_index": question.order_index,
                } for question in task.questions
                  # Frozen copies of already-answered questions stay in the DB
                  # for scoring history, but the admin only edits the live set.
                  if not (question.rich_content or {}).get("superseded")],
            })
        sections.append({"id": section.id, "title": section.title, "order_index": section.order_index, "tasks": tasks})
    return {
        "id": variant.id, "title": variant.title, "instructions": variant.instructions,
        "variant_number": variant.variant_number, "level": level.name, "exam_type": exam_type.name,
        "time_limit_minutes": variant.time_limit_minutes,
        "passing_percentage": variant.passing_percentage,
        "retake_allowed": variant.retake_allowed, "review_allowed": variant.review_allowed,
        "status": variant.status, "sections": sections,
    }


async def create_variant(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, payload: VariantCreate,
) -> dict:
    if not await db.get(Level, payload.level_id):
        raise HTTPException(404, "Level not found.")
    if not await db.get(ExamType, payload.exam_type_id):
        raise HTTPException(404, "Exam type not found.")
    variant = TestVariant(created_by=admin_id, **payload.model_dump())
    db.add(variant)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "A test with this variant number already exists for this level and exam type.") from exc
    await write_audit(
        db, admin_id, "test.create", "TestVariant", str(variant.id), payload.model_dump(mode="json"), ip_address,
    )
    await db.commit()
    await db.refresh(variant)
    return {"id": variant.id, "status": variant.status}


async def update_variant(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    variant_id: uuid.UUID, payload: VariantUpdate,
) -> dict:
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    for key, value in payload.model_dump().items():
        setattr(variant, key, value)
    await write_audit(db, admin_id, "test.update", "TestVariant", str(variant.id), payload.model_dump(), ip_address)
    await db.commit()
    return {"id": variant.id, "status": variant.status}


async def delete_variant(db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, variant_id: uuid.UUID) -> None:
    """Delete ONE test variant with all of its sections/exercises/questions.
    Refused once students have attempted it — their results must survive."""
    variant = await db.get(
        TestVariant, variant_id,
        options=[selectinload(TestVariant.sections).selectinload(Section.tasks).selectinload(Task.questions)],
    )
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    attempts = await db.scalar(
        select(func.count()).select_from(Attempt).where(Attempt.test_variant_id == variant_id)
    )
    if attempts:
        raise HTTPException(409, "This test has student attempts and cannot be deleted. Move it to draft instead.")
    await write_audit(
        db, admin_id, "test.delete", "TestVariant", str(variant_id),
        {"title": variant.title, "variant_number": variant.variant_number}, ip_address,
    )
    await db.delete(variant)
    await db.commit()


async def publish_variant(db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, variant_id: uuid.UUID) -> dict:
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    report = await quality_report(db, variant_id)
    if not report["valid"]:
        raise HTTPException(409, {"message": "Quality check failed.", "errors": report["errors"]})
    variant.status = ContentStatus.PUBLISHED
    await write_audit(db, admin_id, "test.publish", "TestVariant", str(variant.id), ip_address=ip_address)
    await db.commit()
    return {"id": variant.id, "status": variant.status}


async def unpublish_variant(db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, variant_id: uuid.UUID) -> dict:
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    variant.status = ContentStatus.DRAFT
    await write_audit(db, admin_id, "test.unpublish", "TestVariant", str(variant.id), ip_address=ip_address)
    await db.commit()
    return {"id": variant.id, "status": variant.status}


async def reset_all_content(
    db: AsyncSession, admin: User, ip_address: str | None, payload: ResetContent,
) -> dict:
    """One-shot wipe of every test variant (and its sections/tasks/questions)
    plus every attempt, so the platform can be re-seeded manually from scratch.
    Gated behind the admin's own password. Attempts are removed first because
    their FK to test_variants has no cascade; everything below a variant is
    cleared by the DB-level ON DELETE CASCADE."""
    if not verify_password(payload.password, admin.password_hash):
        raise HTTPException(403, "Incorrect password.")
    tests_removed = await db.scalar(select(func.count()).select_from(TestVariant))
    attempts_removed = await db.scalar(select(func.count()).select_from(Attempt))
    await db.execute(delete(Attempt))
    await db.execute(delete(TestVariant))
    await write_audit(
        db, admin.id, "content.reset", "TestVariant", None,
        {"tests_removed": int(tests_removed or 0), "attempts_removed": int(attempts_removed or 0)}, ip_address,
    )
    await db.commit()
    return {"tests_removed": int(tests_removed or 0), "attempts_removed": int(attempts_removed or 0)}
