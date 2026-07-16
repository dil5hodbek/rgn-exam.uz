import logging
import mimetypes
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import require_admin
from app.core.security import verify_password
from app.models import (
    AdminAuditLog, Attempt, AttemptAnswer, AttemptStatus, ContentStatus, ExamType,
    Level, MediaAsset, Question, Role, Section, Task, TelegramLink, TestVariant, User,
)
from app.schemas.content import (
    GradeInput, QuestionCreate, QuestionInput, ReorderTasks, ResetContent,
    SectionInput, TaskCreate, VariantCreate, VariantUpdate,
)
from app.services.audit import write_audit
from app.services.exercise_registry import registry_payload
from app.services.numbering import renumber_questions
from app.services.quality import quality_report
from app.services.question_templates import templates_payload, validate_task_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Administration"])

MEDIA_EXTENSIONS = {
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
}


async def save_media_upload(upload: UploadFile, uploaded_by: uuid.UUID, db: AsyncSession) -> MediaAsset:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in MEDIA_EXTENSIONS:
        raise HTTPException(415, "Upload an audio, video, or image file (mp3, wav, m4a, ogg, mp4, webm, mov, png, jpg, gif, webp).")
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    target = settings.storage_path / "media" / f"{uuid.uuid4()}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_upload_mb * 1024 * 1024:
                output.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, "The file is too large.")
            output.write(chunk)
    media = MediaAsset(
        file_name=upload.filename or target.name,
        file_url=f"/media/media/{target.name}",
        mime_type=mimetypes.guess_type(upload.filename or "")[0] or MEDIA_EXTENSIONS[suffix],
        uploaded_by=uploaded_by,
    )
    db.add(media)
    await db.flush()
    return media


def media_payload(media: MediaAsset) -> dict:
    return {"id": str(media.id), "file_name": media.file_name, "url": media.file_url, "mime_type": media.mime_type}


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


@router.get("/exercise-registry")
async def exercise_registry(_: User = Depends(require_admin)):
    return registry_payload()


@router.get("/question-templates")
async def question_templates(_: User = Depends(require_admin)):
    return templates_payload()


@router.post("/parse-docx")
async def parse_docx_upload(
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
):
    """Read a .docx and return a best-effort exercise draft (type + question
    text) to pre-fill the builder. Nothing is saved; the admin reviews, adds
    media/answers, and saves manually."""
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(415, "Upload a Word .docx file.")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "The document is too large (max 20 MB).")
    try:
        from app.services.docx_import import parse_docx
        result = parse_docx(data)
    except Exception as exc:  # pragma: no cover - malformed uploads
        raise HTTPException(422, "Could not read this .docx file.") from exc
    # Matching exercises carry their content in left/right, not questions.
    has_content = bool(result.get("questions")) or bool(result.get("left")) or bool(result.get("right"))
    if not has_content:
        raise HTTPException(422, "No questions were found in this document.")
    return result


@router.get("/overview")
async def overview(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return {
        "students": await db.scalar(select(func.count()).select_from(User).where(User.role == Role.STUDENT)),
        "attempts": await db.scalar(select(func.count()).select_from(Attempt)),
        "tests": await db.scalar(select(func.count()).select_from(TestVariant)),
        "pending_submissions": await db.scalar(
            select(func.count()).select_from(AttemptAnswer).where(AttemptAnswer.is_correct.is_(None))
        ),
    }


@router.get("/tests")
async def list_tests(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
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
            len(task.questions) for section in variant.sections for task in section.tasks
            if not (task.metadata_json or {}).get("superseded")
        ),
    } for variant, level, exam_type in rows]


@router.get("/tests/{variant_id}")
async def admin_test_detail(
    variant_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
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
    sections = []
    for section in variant.sections:
        tasks = []
        for task in section.tasks:
            # Superseded tasks are retired copies kept only because students
            # already answered them — invisible everywhere in the admin UI.
            if (task.metadata_json or {}).get("superseded"):
                continue
            media = await db.get(MediaAsset, task.media_asset_id) if task.media_asset_id else None
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
                } for question in task.questions],
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


@router.post("/tests", status_code=201)
async def create_variant(payload: VariantCreate, request: Request, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if not await db.get(Level, payload.level_id):
        raise HTTPException(404, "Level not found.")
    if not await db.get(ExamType, payload.exam_type_id):
        raise HTTPException(404, "Exam type not found.")
    variant = TestVariant(created_by=admin.id, **payload.model_dump())
    db.add(variant)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "A test with this variant number already exists for this level and exam type.") from exc
    await write_audit(db, admin.id, "test.create", "TestVariant", str(variant.id), payload.model_dump(mode="json"), request.client.host if request.client else None)
    await db.commit()
    await db.refresh(variant)
    return {"id": variant.id, "status": variant.status}


@router.patch("/tests/{variant_id}")
async def update_variant(
    variant_id: uuid.UUID, payload: VariantUpdate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    for key, value in payload.model_dump().items():
        setattr(variant, key, value)
    await write_audit(db, admin.id, "test.update", "TestVariant", str(variant.id), payload.model_dump(), request.client.host if request.client else None)
    await db.commit()
    return {"id": variant.id, "status": variant.status}


@router.post("/media", status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    media = await save_media_upload(file, admin.id, db)
    await db.commit()
    return media_payload(media)


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: uuid.UUID, payload: TaskCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
    # question — validate up front, then swap the question set atomically. This
    # is blocked once students have answered (their answers would be orphaned).
    if replace_questions:
        problems = validate_task_payload(
            template_key, values["type"], [q.model_dump() for q in payload.questions],
            interaction, values.get("passage_html"),
        )
        if problems:
            raise HTTPException(422, {"message": "Exercise cannot be saved.", "errors": problems})
        has_answers = await db.scalar(
            select(func.count()).select_from(AttemptAnswer)
            .join(Question, Question.id == AttemptAnswer.question_id)
            .where(Question.task_id == task_id)
        )
        if has_answers:
            raise HTTPException(409, "This exercise has student answers and can no longer be edited.")

    for key, value in values.items():
        setattr(task, key, value)
    if interaction is not None:
        metadata = dict(task.metadata_json or {})
        metadata["interaction"] = interaction
        task.metadata_json = metadata

    new_questions: list[Question] = []
    if replace_questions:
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
        db, admin.id, "task.update", "Task", str(task.id),
        {"title": task.title, "type": task.type, "questions": len(new_questions) if replace_questions else None},
        request.client.host if request.client else None,
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


@router.post("/tests/{variant_id}/sections", status_code=201)
async def create_section(
    variant_id: uuid.UUID, payload: SectionInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
        db, admin.id, "section.create", "Section", str(section.id),
        {"variant_id": str(variant_id), "title": section.title},
        request.client.host if request.client else None,
    )
    await db.commit()
    return {"id": section.id, "title": section.title, "order_index": section.order_index, "tasks": []}


@router.patch("/sections/{section_id}")
async def update_section(
    section_id: uuid.UUID, payload: SectionInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(404, "Section not found.")
    section.title = payload.title.strip()
    await write_audit(
        db, admin.id, "section.update", "Section", str(section.id),
        {"title": section.title}, request.client.host if request.client else None,
    )
    await db.commit()
    return {"id": section.id, "title": section.title}


async def _persist_new_task(
    db: AsyncSession, section: Section, payload: TaskCreate, admin: User, request: Request,
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
        db, admin.id, "task.create", "Task", str(task.id),
        {"section_id": str(section.id), "title": task.title, "type": task.type,
         "questions": len(created_questions)},
        request.client.host if request.client else None,
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


@router.post("/sections/{section_id}/tasks", status_code=201)
async def create_task(
    section_id: uuid.UUID, payload: TaskCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(404, "Section not found.")
    return await _persist_new_task(db, section, payload, admin, request)


@router.post("/tests/{variant_id}/tasks", status_code=201)
async def create_task_for_test(
    variant_id: uuid.UUID, payload: TaskCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
    return await _persist_new_task(db, section, payload, admin, request)


@router.post("/tests/{variant_id}/import-docx", status_code=201)
async def import_docx_into_test(
    variant_id: uuid.UUID, request: Request, file: UploadFile = File(...),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    """AI import of a whole test paper: split the .docx into its exercises,
    classify each question type, extract prompts/options/answers, and create
    every exercise in this test. Answers the AI could not settle are saved
    with placeholders and reported back as warnings for the admin to fix."""
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(415, "Upload a Word .docx file.")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "The document is too large (max 20 MB).")

    from app.services.docx_import import ai_available, ai_import_document, build_task_payloads
    if not ai_available():
        raise HTTPException(422, "AI import needs OPENROUTER_API_KEY or ANTHROPIC_API_KEY to be configured.")

    variant = await db.get(TestVariant, variant_id, options=[selectinload(TestVariant.sections)])
    if not variant:
        raise HTTPException(404, "Test variant not found.")

    try:
        exercises = await ai_import_document(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # pragma: no cover - malformed uploads
        raise HTTPException(422, "Could not read this .docx file.") from exc

    payloads, warnings = build_task_payloads(exercises)
    if not payloads:
        raise HTTPException(422, "No exercises could be extracted from this document.")

    section = variant.sections[0] if variant.sections else None
    if not section:
        section = Section(test_variant_id=variant_id, title="Exercises", order_index=1)
        db.add(section)
        await db.flush()

    created = []
    for payload in payloads:
        try:
            result = await _persist_new_task(db, section, TaskCreate(**payload), admin, request)
            created.append({"id": result["id"], "title": result["title"],
                            "type": result["type"], "questions": len(result["questions"])})
        except HTTPException as exc:
            await db.rollback()
            detail = exc.detail
            reason = "; ".join(detail.get("errors", [])) if isinstance(detail, dict) else str(detail)
            warnings.append(f"“{payload['title']}” was skipped: {reason}")
        except Exception:
            await db.rollback()
            logger.warning("Import: could not save task %s", payload["title"], exc_info=True)
            warnings.append(f"“{payload['title']}” was skipped: could not be saved.")

    if not created:
        raise HTTPException(422, {"message": "No exercises could be imported.", "errors": warnings})
    return {"created": len(created), "exercises": created, "warnings": warnings}


@router.post("/tests/{variant_id}/import-answers")
async def import_answers_into_test(
    variant_id: uuid.UUID, request: Request, file: UploadFile = File(...),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    """AI import of an answer key: read the .docx, match its answers to this
    test's existing questions, and update their correct answers. Questions the
    key doesn't cover are left untouched and reported as warnings."""
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(415, "Upload a Word .docx file.")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "The document is too large (max 20 MB).")

    from app.services.docx_import import _extract_lines, ai_available, ai_match_answers, normalise_answer
    if not ai_available():
        raise HTTPException(422, "AI import needs OPENROUTER_API_KEY or ANTHROPIC_API_KEY to be configured.")

    variant = await db.get(
        TestVariant, variant_id,
        options=[selectinload(TestVariant.sections).selectinload(Section.tasks).selectinload(Task.questions)],
    )
    if not variant:
        raise HTTPException(404, "Test variant not found.")

    try:
        key_lines = _extract_lines(data)
    except Exception as exc:  # pragma: no cover - malformed uploads
        raise HTTPException(422, "Could not read this .docx file.") from exc
    if not key_lines:
        raise HTTPException(422, "The answer key document is empty.")

    manual_types = {"writing", "speaking_prompt_placeholder"}
    letter = lambda i: chr(97 + i)  # noqa: E731

    # Build the compact structure the AI matches the key against, plus a
    # code → (task, question) map to apply its output.
    structure: list[str] = [f"TEST: {variant.title} (variant {variant.variant_number})"]
    code_map: dict[str, tuple[Task, Question]] = {}
    tasks = [t for section in sorted(variant.sections, key=lambda s: s.order_index)
             for t in sorted(section.tasks, key=lambda t: t.order_index or 0)]
    for ti, task in enumerate(tasks, start=1):
        interaction = (task.metadata_json or {}).get("interaction") or {}
        kind = interaction.get("kind") or ""
        structure.append(f"\nExercise {ti} (e{ti}) [{task.type}] {task.instructions or task.title}")
        if kind in ("matching", "matching_headings", "gap_match"):
            opts = interaction.get("options") or []
            labels = "  ".join(
                f"{(o.get('value') if isinstance(o, dict) else letter(i))}) {(o.get('label') if isinstance(o, dict) else o)}"
                for i, o in enumerate(opts)
            )
            structure.append(f"  right options: {labels}")
        if kind == "gap_match":
            structure.append(f"  word box: {', '.join(interaction.get('words') or [])}")
            structure.append("  note: rows starting with 'Reply ·' take the LETTER of the matching reply; other rows take the word from the box.")
        for qi, question in enumerate(sorted(task.questions, key=lambda q: q.order_index or 0), start=1):
            code = f"e{ti}q{qi}"
            code_map[code] = (task, question)
            line = f"  {code}: {question.prompt}"
            if question.options:
                line += " | options: " + "  ".join(f"{letter(i)}) {o}" for i, o in enumerate(question.options))
            structure.append(line)

    matches = await ai_match_answers("\n".join(structure), "\n".join(key_lines))
    if not matches:
        raise HTTPException(422, "The AI could not match any answers from this document.")

    updated = 0
    warnings: list[str] = []
    seen_tasks: set[uuid.UUID] = set()
    for match in matches:
        pair = code_map.get(match["code"])
        if not pair:
            warnings.append(f"Answer for unknown question code '{match['code']}' ignored.")
            continue
        task, question = pair
        if task.type in manual_types:
            continue
        interaction = (task.metadata_json or {}).get("interaction") or {}
        kind = interaction.get("kind") or ""
        if kind == "gap_match":
            # Alternating rows: "Reply · …" rows take the reply letter, the
            # others take the word from the box.
            if question.prompt.startswith("Reply ·"):
                norm_kind, norm_opts = "matching", interaction.get("options") or []
            else:
                norm_kind, norm_opts = "text", []
        elif kind in ("matching", "matching_headings"):
            norm_kind, norm_opts = "matching", interaction.get("options") or []
        elif task.type == "multi_select":
            norm_kind, norm_opts = "options_multi", question.options or []
        elif task.type in ("true_false", "true_false_not_given"):
            norm_kind, norm_opts = "binary", []
        elif question.options:
            norm_kind, norm_opts = "options_single", question.options
        else:
            norm_kind, norm_opts = "text", []
        value, problem = normalise_answer(
            norm_kind, norm_opts, match["answer"], tfng=task.type == "true_false_not_given",
        )
        if problem:
            warnings.append(f"“{task.title[:60]}” — {match['code']}: {problem}.")
            continue
        question.correct_answer = value
        seen_tasks.add(task.id)
        updated += 1

    unanswered = [
        f"e{ti}q{qi}"
        for ti, task in enumerate(tasks, start=1) if task.type not in manual_types
        for qi, question in enumerate(sorted(task.questions, key=lambda q: q.order_index or 0), start=1)
        if f"e{ti}q{qi}" not in {m["code"] for m in matches} and not question.is_example
    ]
    if unanswered:
        warnings.append(f"No answer found in the key for: {', '.join(unanswered[:25])}"
                        + (f" (+{len(unanswered) - 25} more)" if len(unanswered) > 25 else ""))

    await write_audit(
        db, admin.id, "test.import_answers", "TestVariant", str(variant_id),
        {"updated": updated, "file": file.filename},
        request.client.host if request.client else None,
    )
    await db.commit()
    return {"updated": updated, "warnings": warnings}


@router.post("/tests/{variant_id}/reorder-tasks")
async def reorder_tasks(
    variant_id: uuid.UUID, payload: ReorderTasks, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
        db, admin.id, "tasks.reorder", "TestVariant", str(variant_id),
        {"order": [str(tid) for tid in payload.task_ids]},
        request.client.host if request.client else None,
    )
    await db.commit()
    return {"ok": True}


@router.post("/tasks/{task_id}/duplicate", status_code=201)
async def duplicate_task(
    task_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
        db, admin.id, "task.duplicate", "Task", str(copy.id),
        {"source_task": str(task_id)}, request.client.host if request.client else None,
    )
    await db.commit()
    return {"id": copy.id, "title": copy.title}


@router.post("/tasks/{task_id}/questions", status_code=201)
async def create_question(
    task_id: uuid.UUID, payload: QuestionCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id, options=[selectinload(Task.questions)])
    if not task:
        raise HTTPException(404, "Task not found.")
    last_order = await db.scalar(select(func.max(Question.order_index)).where(Question.task_id == task_id))
    question = Question(task_id=task_id, order_index=(last_order or 0) + 1, **payload.model_dump())
    db.add(question)
    await db.flush()
    renumber_questions([*task.questions, question])
    await write_audit(
        db, admin.id, "question.create", "Question", str(question.id),
        {"task_id": str(task_id), "prompt": question.prompt},
        request.client.host if request.client else None,
    )
    await db.commit()
    return {
        "id": question.id, **payload.model_dump(mode="json"),
        "order_index": question.order_index,
    }


@router.patch("/questions/{question_id}")
async def update_question(
    question_id: uuid.UUID, payload: QuestionInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    question = await db.get(Question, question_id)
    if not question:
        raise HTTPException(404, "Question not found.")
    for key, value in payload.model_dump().items():
        setattr(question, key, value)
    await write_audit(db, admin.id, "question.update", "Question", str(question.id), payload.model_dump(mode="json"), request.client.host if request.client else None)
    await db.commit()
    return {"id": question.id}


@router.delete("/questions/{question_id}", status_code=204)
async def delete_question(
    question_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
        db, admin.id, "question.delete", "Question", str(question.id),
        {"prompt": question.prompt}, request.client.host if request.client else None,
    )
    await db.delete(question)
    await db.flush()
    remaining = (await db.execute(select(Question).where(Question.task_id == task_id))).scalars().all()
    renumber_questions(list(remaining))
    await db.commit()


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
    await write_audit(
        db, admin.id, "task.delete", "Task", str(task.id),
        {"title": task.title}, request.client.host if request.client else None,
    )
    await db.delete(task)
    await db.commit()


@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(
    section_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
        db, admin.id, "section.delete", "Section", str(section.id),
        {"title": section.title}, request.client.host if request.client else None,
    )
    await db.delete(section)
    await db.commit()


@router.post("/tests/{variant_id}/quality-check")
async def check_variant_quality(
    variant_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await quality_report(db, variant_id)


@router.post("/tests/{variant_id}/publish")
async def publish_variant(
    variant_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    report = await quality_report(db, variant_id)
    if not report["valid"]:
        raise HTTPException(409, {"message": "Quality check failed.", "errors": report["errors"]})
    variant.status = ContentStatus.PUBLISHED
    await write_audit(db, admin.id, "test.publish", "TestVariant", str(variant.id), ip_address=request.client.host if request.client else None)
    await db.commit()
    return {"id": variant.id, "status": variant.status}


@router.post("/tests/{variant_id}/unpublish")
async def unpublish_variant(
    variant_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")
    variant.status = ContentStatus.DRAFT
    await write_audit(
        db, admin.id, "test.unpublish", "TestVariant", str(variant.id),
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()
    return {"id": variant.id, "status": variant.status}


@router.delete("/content")
async def reset_all_content(
    payload: ResetContent, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
        {"tests_removed": int(tests_removed or 0), "attempts_removed": int(attempts_removed or 0)},
        request.client.host if request.client else None,
    )
    await db.commit()
    return {"tests_removed": int(tests_removed or 0), "attempts_removed": int(attempts_removed or 0)}


@router.get("/students")
async def students(search: str = "", _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    query = select(User).where(User.role == Role.STUDENT)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            User.first_name.ilike(term) | User.last_name.ilike(term) | User.phone_number.ilike(term)
        )
    rows = (await db.execute(query.order_by(User.created_at.desc()).limit(100))).scalars().all()
    return [{
        "id": row.id, "first_name": row.first_name, "last_name": row.last_name,
        "phone_number": row.phone_number, "is_active": row.is_active,
        "telegram_linked": bool(row.telegram_link), "created_at": row.created_at,
    } for row in rows]


@router.patch("/students/{student_id}/active")
async def set_student_active(
    student_id: uuid.UUID, active: bool, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    student = await db.get(User, student_id)
    if not student or student.role != Role.STUDENT:
        raise HTTPException(404, "Student not found.")
    student.is_active = active
    await write_audit(db, admin.id, "student.active", "User", str(student.id), {"active": active}, request.client.host if request.client else None)
    await db.commit()
    return {"id": student.id, "is_active": student.is_active}


@router.delete("/students/{student_id}/telegram", status_code=204)
async def admin_unlink_telegram(
    student_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    link = await db.scalar(select(TelegramLink).where(TelegramLink.user_id == student_id))
    if link:
        await db.delete(link)
    await write_audit(db, admin.id, "student.telegram_unlink", "User", str(student_id), ip_address=request.client.host if request.client else None)
    await db.commit()


@router.get("/audit-log")
async def audit_log(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(200)
    )).scalars().all()
    return [{
        "id": row.id, "actor_id": row.actor_id, "action": row.action,
        "entity_type": row.entity_type, "entity_id": row.entity_id,
        "metadata": row.metadata_json, "ip_address": row.ip_address, "created_at": row.created_at,
    } for row in rows]


@router.get("/submissions/pending")
async def pending_submissions(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
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


@router.post("/attempt-answers/{answer_id}/grade")
async def grade_submission(
    answer_id: uuid.UUID, payload: GradeInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
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
    answer.graded_by = admin.id
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
    await write_audit(db, admin.id, "submission.grade", "AttemptAnswer", str(answer.id), payload.model_dump(), request.client.host if request.client else None)
    await db.commit()
    return {
        "id": answer.id, "points_awarded": answer.points_awarded,
        "attempt_status": attempt.status, "attempt_percentage": attempt.percentage,
    }


@router.get("/reports/attempts.xlsx")
async def export_attempts(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Attempt).order_by(Attempt.started_at.desc()))).scalars().all()
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Attempts"
    sheet.append(["Attempt ID", "Student ID", "Test Variant ID", "Status", "Score", "Maximum", "Percentage", "Started", "Submitted", "Time (seconds)"])
    for row in rows:
        sheet.append([
            str(row.id), str(row.user_id), str(row.test_variant_id), row.status.value,
            float(row.total_score or 0), float(row.max_score or 0), float(row.percentage or 0),
            row.started_at.isoformat(), row.submitted_at.isoformat() if row.submitted_at else "",
            row.time_spent_seconds or 0,
        ])
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=examflow-attempts.xlsx"},
    )
