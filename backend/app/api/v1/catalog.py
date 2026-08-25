import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import current_user
from app.models import Attempt, ContentStatus, ExamType, Level, MediaAsset, Section, Task, TestVariant, User

router = APIRouter(tags=["Catalog"])


async def serialize_sections(db: AsyncSession, sections: list[Section]) -> list[dict]:
    result = []
    for section in sections:
        tasks = []
        for task in section.tasks:
            if (task.metadata_json or {}).get("superseded"):
                continue
            media = await db.get(MediaAsset, task.media_asset_id) if task.media_asset_id else None
            tasks.append({
                "id": task.id,
                "type": task.type,
                "title": task.title,
                "instructions": task.instructions,
                "passage_html": task.passage_html,
                "audio_replay_limit": task.audio_replay_limit,
                "interaction": (task.metadata_json or {}).get("interaction", {}),
                "media": ({
                    "id": media.id, "url": media.file_url, "mime_type": media.mime_type,
                    "file_name": media.file_name,
                } if media else None),
                "questions": [{
                    "id": question.id,
                    "prompt": question.prompt,
                    "options": question.options,
                    "points": float(question.points),
                    "is_example": question.is_example,
                    # Examples show their model answer to the student; real
                    # questions never leak the answer key.
                    "example_answer": question.correct_answer if question.is_example else None,
                    "order_index": question.order_index,
                } for question in task.questions if not (question.rich_content or {}).get("superseded")],
            })
        result.append({"id": section.id, "title": section.title, "order_index": section.order_index, "tasks": tasks})
    return result


@router.get("/levels")
async def levels(_: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Level).order_by(Level.order_index))).scalars().all()
    result = []
    for level in rows:
        total = await db.scalar(select(func.count()).select_from(TestVariant).where(
            TestVariant.level_id == level.id, TestVariant.status == ContentStatus.PUBLISHED
        ))
        result.append({
            "id": level.id, "name": level.name, "slug": level.slug,
            "description": level.description, "published_tests": total or 0,
        })
    return result


@router.get("/levels/{level_slug}/exam-types")
async def exam_types(level_slug: str, _: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    level = await db.scalar(select(Level).where(Level.slug == level_slug))
    types = (await db.execute(select(ExamType))).scalars().all()
    return [{"id": row.id, "name": row.name, "slug": row.slug, "level_id": level.id if level else None} for row in types]


@router.get("/levels/{level_slug}/exam-types/{type_slug}/variants")
async def variants(level_slug: str, type_slug: str, _: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(TestVariant)
        .join(Level).join(ExamType)
        .where(Level.slug == level_slug, ExamType.slug == type_slug, TestVariant.status == ContentStatus.PUBLISHED)
        .order_by(TestVariant.variant_number)
    )).scalars().all()
    return [{
        "id": row.id, "title": row.title, "variant_number": row.variant_number,
        "time_limit_minutes": row.time_limit_minutes, "passing_percentage": row.passing_percentage,
        "retake_allowed": row.retake_allowed,
    } for row in rows]


@router.get("/tests/{test_id}")
async def test_detail(test_id: uuid.UUID, _: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    variant = await db.scalar(
        select(TestVariant)
        .where(TestVariant.id == test_id, TestVariant.status == ContentStatus.PUBLISHED)
        .options(
            selectinload(TestVariant.sections)
            .selectinload(Section.tasks)
            .selectinload(Task.questions)
        )
    )
    if not variant:
        raise HTTPException(404, "Published test not found.")
    return {
        "id": variant.id,
        "title": variant.title,
        "instructions": variant.instructions,
        "time_limit_minutes": variant.time_limit_minutes,
        "passing_percentage": variant.passing_percentage,
        "review_allowed": variant.review_allowed,
        "sections": await serialize_sections(db, list(variant.sections)),
    }


@router.get("/attempts/{attempt_id}/test")
async def attempt_test_detail(
    attempt_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db),
):
    """Same shape as GET /tests/{test_id}, but for a specific attempt — used
    instead of that endpoint whenever the attempt might carry extra_task_ids
    (a "random test" mixed in exercises from the other exam type), since
    those tasks live outside the primary TestVariant's own sections and
    GET /tests/{test_id} has no way to know about them."""
    from app.api.v1.attempts import attempt_sections, attempt_variant, owned_attempt  # noqa: PLC0415

    attempt = await owned_attempt(db, attempt_id, user.id)
    variant = await attempt_variant(db, attempt)
    sections = await attempt_sections(db, attempt)
    return {
        "id": variant.id,
        "title": variant.title,
        "instructions": variant.instructions,
        "time_limit_minutes": variant.time_limit_minutes,
        "passing_percentage": variant.passing_percentage,
        "review_allowed": variant.review_allowed,
        "sections": await serialize_sections(db, sections),
    }
