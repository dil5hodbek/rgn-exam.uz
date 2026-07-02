import uuid
import re
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from rapidfuzz import fuzz, process
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import require_admin
from app.importer.roadmap_import import persist_parsed
from app.importer.structured_parser import draft_to_parsed_tests, find_exercise
from app.models import (
    AdminAuditLog, Attempt, AttemptAnswer, AttemptStatus, ContentStatus, ExamType, ImportJob,
    ImportStatus, Level, MediaAsset, Question, Role, Section, Task, TelegramLink, TestVariant, User,
)
from app.schemas.content import (
    GradeInput, ImportExerciseUpdate, ImportQuestionUpdate, QuestionCreate, QuestionInput,
    SectionInput, TaskCreate, TaskUpdate, VariantCreate, VariantUpdate,
)
from app.services.audit import write_audit
from app.services.exercise_registry import (
    EXERCISE_REGISTRY, MANUAL_TASK_TYPES, default_kind, interaction_matches_type, registry_payload,
)
from app.services.numbering import renumber_questions
from app.services.question_classifier import classify_task, infer_interaction
from app.worker import import_package

router = APIRouter(prefix="/admin", tags=["Administration"])


async def quality_report(db: AsyncSession, variant_id: uuid.UUID) -> dict:
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
    errors: list[dict[str, str | None]] = []
    warnings: list[dict[str, str | None]] = []

    def issue(
        target: list[dict[str, str | None]],
        scope: str,
        message: str,
        section_id: uuid.UUID | None = None,
        task_id: uuid.UUID | None = None,
        question_id: uuid.UUID | None = None,
    ) -> None:
        target.append({
            "scope": scope,
            "message": message,
            "section_id": str(section_id) if section_id else None,
            "task_id": str(task_id) if task_id else None,
            "question_id": str(question_id) if question_id else None,
        })

    if not variant.title.strip():
        issue(errors, "test", "Test title is empty.")
    if variant.variant_number < 1:
        issue(errors, "test", "Variant number must be positive.")
    if not 1 <= variant.time_limit_minutes <= 300:
        issue(errors, "test", "Time limit must be between 1 and 300 minutes.")
    if not 0 <= variant.passing_percentage <= 100:
        issue(errors, "test", "Passing percentage must be between 0 and 100.")
    if not await db.get(Level, variant.level_id):
        issue(errors, "test", "Level is missing or invalid.")
    if not await db.get(ExamType, variant.exam_type_id):
        issue(errors, "test", "Exam type is missing or invalid.")
    if not variant.sections:
        issue(errors, "test", "Add at least one section.")
    scored_questions = 0
    for section in variant.sections:
        active_tasks = [
            task for task in section.tasks
            if not (task.metadata_json or {}).get("superseded")
        ]
        if not active_tasks:
            issue(errors, section.title, "Section has no active exercises.", section.id)
        for task in active_tasks:
            scope = f"{section.title} / {task.title}"
            metadata = task.metadata_json or {}
            if not task.title.strip():
                issue(errors, scope, "Exercise title is empty.", section.id, task.id)
            if not task.instructions.strip():
                issue(errors, scope, "Exercise instructions are empty.", section.id, task.id)
            active_questions = [
                question for question in task.questions
                if not (question.rich_content or {}).get("superseded")
            ]
            if not active_questions:
                issue(errors, scope, "Exercise has no active questions.", section.id, task.id)
            interaction = metadata.get("interaction", {})
            kind = interaction.get("kind")
            if kind not in EXERCISE_REGISTRY:
                issue(errors, scope, "Interaction kind is missing or unsupported.", section.id, task.id)
            elif not interaction_matches_type(kind, task.type):
                issue(errors, scope, f"Interaction {kind} does not match task type {task.type}.", section.id, task.id)
            confidence = float(metadata.get("confidence", 1))
            if confidence < 0.8 and not metadata.get("manual_approved"):
                issue(errors, scope, f"Parser confidence {confidence:.2f} requires manual approval.", section.id, task.id)
            for message in metadata.get("warnings", []):
                issue(warnings, scope, str(message), section.id, task.id)
            if metadata.get("source_document") and not metadata.get("context_kind"):
                issue(errors, scope, "Imported task source context is missing.", section.id, task.id)
            if re.search(r"\brecording\s*\d+", task.instructions, re.I) and not task.media_asset_id:
                issue(errors, scope, "Listening recording has no attached audio/video.", section.id, task.id)
            interaction_options = interaction.get("options", [])
            option_values = [
                str(option.get("value", "") if isinstance(option, dict) else option).strip()
                for option in interaction_options
            ]
            if kind in {"word_bank", "matching", "matching_headings"} and not option_values:
                issue(errors, scope, "Interaction options are empty.", section.id, task.id)
            normalized_values = [value.casefold() for value in option_values]
            if len(normalized_values) != len(set(normalized_values)):
                issue(errors, scope, "Interaction options contain duplicate values.", section.id, task.id)
            if kind == "cloze_passage":
                template = interaction.get("template", "")
                placeholders = re.findall(r"\{\{(\d+)\}\}", template)
                expected = [str(question.order_index) for question in active_questions]
                if not template.strip() or set(placeholders) != set(expected) or len(placeholders) != len(expected):
                    issue(errors, scope, "Cloze placeholders and questions do not match exactly.", section.id, task.id)
            prompts_seen: set[str] = set()
            assigned_answers: list[str] = []
            for index, question in enumerate(active_questions, start=1):
                question_scope = f"{scope} / Question {index}"
                if not question.prompt.strip():
                    issue(errors, question_scope, "Question prompt is empty.", section.id, task.id, question.id)
                normalized_prompt = re.sub(r"\s+", " ", question.prompt).strip().casefold()
                if normalized_prompt in prompts_seen:
                    issue(errors, question_scope, "Duplicate prompt inside this exercise.", section.id, task.id, question.id)
                prompts_seen.add(normalized_prompt)
                if question.is_example:
                    if float(question.points) != 0:
                        issue(errors, question_scope, "Example questions must have 0 points.", section.id, task.id, question.id)
                    continue
                scored_questions += 1
                if float(question.points) <= 0:
                    issue(errors, question_scope, "Scored questions must have positive points.", section.id, task.id, question.id)
                if task.type in MANUAL_TASK_TYPES:
                    continue
                if question.correct_answer in (None, "", []):
                    issue(errors, question_scope, "Correct answer is missing.", section.id, task.id, question.id)
                    continue
                question_values = [
                    str(option.get("value", "") if isinstance(option, dict) else option).strip()
                    for option in question.options
                ]
                if task.type in {"multiple_choice", "multi_select", "dropdown_gap_fill"}:
                    normalized = [value.casefold() for value in question_values]
                    if not normalized:
                        issue(errors, question_scope, "Choice options are empty.", section.id, task.id, question.id)
                    if len(normalized) != len(set(normalized)):
                        issue(errors, question_scope, "Options contain duplicates.", section.id, task.id, question.id)
                    if task.type != "multi_select" and str(question.correct_answer).strip().casefold() not in normalized:
                        issue(errors, question_scope, "Correct answer is not one of the options.", section.id, task.id, question.id)
                if kind == "inline_alternatives":
                    if len(question_values) != 2:
                        issue(errors, question_scope, "Inline alternative must contain exactly two parsed options.", section.id, task.id, question.id)
                    elif str(question.correct_answer).strip().casefold() not in {
                        value.casefold() for value in question_values
                    }:
                        issue(errors, question_scope, "Inline answer is not one of its alternatives.", section.id, task.id, question.id)
                if kind in {"word_bank", "matching", "matching_headings"}:
                    accepted = {
                        str(value).strip().casefold()
                        for value in [question.correct_answer, *question.accepted_answers]
                    }
                    if not accepted.intersection(normalized_values):
                        issue(errors, question_scope, "Answer is not present in interaction options.", section.id, task.id, question.id)
                    assigned_answers.append(str(question.correct_answer).strip().casefold())
                if kind == "binary_choice":
                    valid = {"true", "false"} | ({"not given"} if task.type == "true_false_not_given" else set())
                    if str(question.correct_answer).strip().casefold() not in valid:
                        issue(errors, question_scope, "Binary answer is not normalized.", section.id, task.id, question.id)
                if kind == "correction" and not question.accepted_answers:
                    issue(warnings, question_scope, "Correction has no alternative accepted answers; uncertain responses require review.", section.id, task.id, question.id)
            if kind in {"word_bank", "matching", "matching_headings"} and not interaction.get("reuse_options", False):
                if len(assigned_answers) != len(set(assigned_answers)):
                    issue(errors, scope, "A non-reusable interaction assigns the same option more than once.", section.id, task.id)
                if len(option_values) < len(active_questions):
                    issue(errors, scope, "There are fewer options than question blanks.", section.id, task.id)
    if scored_questions == 0:
        issue(errors, "test", "Test has no scored questions.")
    return {"valid": not errors, "errors": errors, "warnings": warnings}


@router.get("/exercise-registry")
async def exercise_registry(_: User = Depends(require_admin)):
    return registry_payload()


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
        "tasks_count": sum(len(section.tasks) for section in variant.sections),
        "questions_count": sum(len(task.questions) for section in variant.sections for task in section.tasks),
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
    variant = TestVariant(created_by=admin.id, **payload.model_dump())
    db.add(variant)
    await db.flush()
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


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: uuid.UUID, payload: TaskUpdate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found.")
    values = payload.model_dump()
    interaction = values.pop("interaction", None)
    for key, value in values.items():
        setattr(task, key, value)
    if interaction is not None:
        metadata = dict(task.metadata_json or {})
        metadata["interaction"] = interaction
        task.metadata_json = metadata
    await write_audit(db, admin.id, "task.update", "Task", str(task.id), payload.model_dump(), request.client.host if request.client else None)
    await db.commit()
    return {"id": task.id}


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


@router.post("/sections/{section_id}/tasks", status_code=201)
async def create_task(
    section_id: uuid.UUID, payload: TaskCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(404, "Section not found.")
    last_order = await db.scalar(select(func.max(Task.order_index)).where(Task.section_id == section_id))
    values = payload.model_dump()
    interaction = values.pop("interaction", None)
    task = Task(
        section_id=section_id,
        order_index=(last_order or 0) + 1,
        metadata_json={"interaction": interaction} if interaction else {},
        **values,
    )
    db.add(task)
    await db.flush()
    await write_audit(
        db, admin.id, "task.create", "Task", str(task.id),
        {"section_id": str(section_id), "title": task.title, "type": task.type},
        request.client.host if request.client else None,
    )
    await db.commit()
    return {
        "id": task.id, "title": task.title, "type": task.type,
        "instructions": task.instructions, "passage_html": task.passage_html,
        "audio_replay_limit": task.audio_replay_limit,
        "interaction": interaction or {}, "questions": [],
    }


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


@router.post("/imports", status_code=202)
async def upload_package(
    request: Request,
    package: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    suffix = Path(package.filename or "").suffix.lower()
    if suffix not in {".zip", ".rar"}:
        raise HTTPException(415, "Upload a ZIP or RAR package.")
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    target = settings.storage_path / f"{uuid.uuid4()}{suffix}"
    size = 0
    with target.open("wb") as output:
        while chunk := await package.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_upload_mb * 1024 * 1024:
                output.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, "The package is too large.")
            output.write(chunk)
    job = ImportJob(file_name=package.filename or target.name, source_path=str(target), created_by=admin.id)
    db.add(job)
    await db.flush()
    await write_audit(db, admin.id, "import.enqueue", "ImportJob", str(job.id), {"file_name": job.file_name}, request.client.host if request.client else None)
    await db.commit()
    import_package.delay(str(job.id))
    return {"job_id": job.id, "status": job.status}


@router.get("/imports/{job_id}")
async def import_preview(job_id: uuid.UUID, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(404, "Import job not found.")
    return {
        "id": job.id, "file_name": job.file_name, "status": job.status, "progress": job.progress,
        "manifest": job.manifest, "warnings": job.warnings, "result": job.result,
    }


@router.patch("/imports/{job_id}/exercises/{exercise_ref}")
async def update_import_exercise(
    job_id: uuid.UUID, exercise_ref: str, payload: ImportExerciseUpdate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(404, "Import job not found.")
    located = find_exercise(job.result or {}, exercise_ref)
    if not located:
        raise HTTPException(404, "Exercise not found in this import.")
    _test, section, exercise = located
    values = payload.model_dump(exclude_unset=True)
    if "instructions" in values:
        exercise["instructions"] = values["instructions"]
    if "question_type" in values and values["question_type"]:
        exercise["question_type"] = values["question_type"]
        exercise["suggested_type"] = values["question_type"]
        exercise["confidence"] = 1.0
        exercise["needs_review"] = False
        exercise["reasons"] = ["Manually set by admin."]
        if not values.get("interaction"):
            exercise["interaction"] = infer_interaction(
                values["question_type"], exercise.get("instructions", ""), section.get("title", ""),
            )
    if values.get("interaction"):
        exercise["interaction"] = values["interaction"]
    flag_modified(job, "result")
    await write_audit(
        db, admin.id, "import.exercise_update", "ImportJob", f"{job_id}:{exercise_ref}",
        values, request.client.host if request.client else None,
    )
    await db.commit()
    return exercise


@router.patch("/imports/{job_id}/exercises/{exercise_ref}/questions/{number}")
async def update_import_question(
    job_id: uuid.UUID, exercise_ref: str, number: int, payload: ImportQuestionUpdate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(404, "Import job not found.")
    located = find_exercise(job.result or {}, exercise_ref)
    if not located:
        raise HTTPException(404, "Exercise not found in this import.")
    _test, _section, exercise = located
    question = next((item for item in exercise.get("questions", []) if item.get("number") == number), None)
    if not question:
        raise HTTPException(404, "Question not found in this exercise.")
    values = payload.model_dump(exclude_unset=True)
    question.update(values)
    flag_modified(job, "result")
    await write_audit(
        db, admin.id, "import.question_update", "ImportJob", f"{job_id}:{exercise_ref}:{number}",
        values, request.client.host if request.client else None,
    )
    await db.commit()
    return question


@router.post("/imports/{job_id}/exercises/{exercise_ref}/reclassify")
async def reclassify_import_exercise(
    job_id: uuid.UUID, exercise_ref: str, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(404, "Import job not found.")
    located = find_exercise(job.result or {}, exercise_ref)
    if not located:
        raise HTTPException(404, "Exercise not found in this import.")
    _test, section, exercise = located
    classification = classify_task(exercise.get("instructions", ""), section.get("title", ""))
    exercise["question_type"] = classification.question_type
    exercise["confidence"] = classification.confidence
    exercise["needs_review"] = classification.needs_review
    exercise["reasons"] = classification.reasons
    if classification.question_type:
        exercise["interaction"] = infer_interaction(
            classification.question_type, exercise.get("instructions", ""), section.get("title", ""),
        )
    flag_modified(job, "result")
    await write_audit(
        db, admin.id, "import.reclassify", "ImportJob", f"{job_id}:{exercise_ref}",
        {"question_type": classification.question_type}, request.client.host if request.client else None,
    )
    await db.commit()
    return exercise


@router.post("/imports/{job_id}/commit")
async def commit_import(
    job_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(404, "Import job not found.")
    data = job.result or {}
    if not isinstance(data, dict) or "tests" not in data:
        raise HTTPException(409, "This import is outdated and cannot be committed. Please re-upload the file.")
    parsed_tests = draft_to_parsed_tests(data)
    if not parsed_tests:
        raise HTTPException(422, "This import has no tests to commit.")

    levels = (await db.execute(select(Level))).scalars().all()
    exam_types = (await db.execute(select(ExamType))).scalars().all()
    if not levels or not exam_types:
        raise HTTPException(422, "No levels or exam types are configured yet.")
    level_names = [row.name for row in levels]

    created: list[dict] = []
    skipped: list[str] = []
    for test_dict, parsed in zip(data.get("tests", []), parsed_tests):
        level_row = next((row for row in levels if row.name == parsed.level), None)
        if not level_row:
            match = process.extractOne(parsed.level, level_names, scorer=fuzz.partial_ratio, score_cutoff=60)
            level_row = next((row for row in levels if row.name == match[0]), None) if match else None
            level_row = level_row or levels[0]
        exam_row = next((row for row in exam_types if row.slug == parsed.exam_slug), exam_types[0])

        existing = await db.scalar(select(TestVariant.id).where(
            TestVariant.level_id == level_row.id,
            TestVariant.exam_type_id == exam_row.id,
            TestVariant.variant_number == parsed.variant,
        ))
        if existing:
            skipped.append(parsed.title)
            continue

        exercise_needs_review = any(
            exercise.get("needs_review")
            for section in test_dict.get("sections", [])
            for exercise in section.get("exercises", [])
        )
        status = ContentStatus.NEEDS_REVIEW if (
            exercise_needs_review or level_row.name != parsed.level or exam_row.slug != parsed.exam_slug
        ) else ContentStatus.PUBLISHED

        # Numbering is always server-computed, 1..N within each exercise —
        # persist_parsed() does this itself (and keeps cloze_passage
        # templates in sync with the renumbering), so it isn't duplicated here.
        variant = await persist_parsed(
            db, parsed, level_row, exam_row, admin.id,
            source_document=str(parsed.source_path), status=status,
        )
        await db.flush()
        created.append({"id": str(variant.id), "title": variant.title})
        await write_audit(
            db, admin.id, "import.commit", "TestVariant", str(variant.id),
            {"job_id": str(job_id), "title": variant.title}, request.client.host if request.client else None,
        )
    job.status = ImportStatus.COMPLETED
    await db.commit()
    return {"variants": created, "skipped": skipped}


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
    answer.rubric_scores = payload.rubric_scores
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
