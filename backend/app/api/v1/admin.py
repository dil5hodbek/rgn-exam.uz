import logging
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_admin
from app.models import Attempt, AttemptAnswer, Role, TestVariant, User
from app.schemas.content import (
    GradeInput, QuestionCreate, QuestionInput, ReorderTasks, ResetContent,
    SectionInput, TaskCreate, VariantCreate, VariantUpdate,
)
from app.services import (
    admin_content, admin_grading, admin_import, admin_media, admin_reports, admin_students, admin_tests,
)
from app.services.exercise_registry import registry_payload
from app.services.quality import quality_report
from app.services.question_templates import templates_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Administration"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


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
    return await admin_tests.list_tests(db)


@router.get("/tests/{variant_id}")
async def admin_test_detail(
    variant_id: uuid.UUID, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_tests.admin_test_detail(db, variant_id)


@router.post("/tests", status_code=201)
async def create_variant(
    payload: VariantCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_tests.create_variant(db, admin.id, _ip(request), payload)


@router.patch("/tests/{variant_id}")
async def update_variant(
    variant_id: uuid.UUID, payload: VariantUpdate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_tests.update_variant(db, admin.id, _ip(request), variant_id, payload)


@router.delete("/tests/{variant_id}", status_code=204)
async def delete_variant(
    variant_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    await admin_tests.delete_variant(db, admin.id, _ip(request), variant_id)


@router.post("/media", status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    media = await admin_media.save_media_upload(file, admin.id, db)
    await db.commit()
    return admin_media.media_payload(media)


@router.post("/tests/{variant_id}/sections", status_code=201)
async def create_section(
    variant_id: uuid.UUID, payload: SectionInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.create_section(db, admin.id, _ip(request), variant_id, payload)


@router.patch("/sections/{section_id}")
async def update_section(
    section_id: uuid.UUID, payload: SectionInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.update_section(db, admin.id, _ip(request), section_id, payload)


@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(
    section_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    await admin_content.delete_section(db, admin.id, _ip(request), section_id)


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: uuid.UUID, payload: TaskCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.update_task(db, admin.id, _ip(request), task_id, payload)


@router.post("/sections/{section_id}/tasks", status_code=201)
async def create_task(
    section_id: uuid.UUID, payload: TaskCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.create_task(db, admin.id, _ip(request), section_id, payload)


@router.post("/tests/{variant_id}/tasks", status_code=201)
async def create_task_for_test(
    variant_id: uuid.UUID, payload: TaskCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.create_task_for_test(db, admin.id, _ip(request), variant_id, payload)


@router.post("/tests/{variant_id}/import-docx", status_code=202)
async def import_docx_into_test(
    variant_id: uuid.UUID, request: Request, file: UploadFile = File(...),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    """Queue an AI import of a whole test paper onto the Celery worker. Returns
    immediately with a job id — poll GET /admin/import-jobs/{id} for progress."""
    return await admin_import.queue_docx_import(db, admin.id, _ip(request), variant_id, file)


@router.post("/tests/{variant_id}/import-answers", status_code=202)
async def import_answers_into_test(
    variant_id: uuid.UUID, file: UploadFile = File(...),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    """Queue an AI import of an answer key onto the Celery worker. Poll
    GET /admin/import-jobs/{id} for the result."""
    return await admin_import.queue_answers_import(db, admin.id, variant_id, file)


@router.get("/import-jobs/{job_id}")
async def import_job_status(
    job_id: uuid.UUID, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_import.get_import_job(db, job_id)


@router.post("/tests/{variant_id}/reorder-tasks")
async def reorder_tasks(
    variant_id: uuid.UUID, payload: ReorderTasks, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.reorder_tasks(db, admin.id, _ip(request), variant_id, payload)


@router.post("/tasks/{task_id}/duplicate", status_code=201)
async def duplicate_task(
    task_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.duplicate_task(db, admin.id, _ip(request), task_id)


@router.post("/tasks/{task_id}/questions", status_code=201)
async def create_question(
    task_id: uuid.UUID, payload: QuestionCreate, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.create_question(db, admin.id, _ip(request), task_id, payload)


@router.patch("/questions/{question_id}")
async def update_question(
    question_id: uuid.UUID, payload: QuestionInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_content.update_question(db, admin.id, _ip(request), question_id, payload)


@router.delete("/questions/{question_id}", status_code=204)
async def delete_question(
    question_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    await admin_content.delete_question(db, admin.id, _ip(request), question_id)


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    await admin_content.delete_task(db, admin.id, _ip(request), task_id)


@router.post("/tests/{variant_id}/quality-check")
async def check_variant_quality(
    variant_id: uuid.UUID, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await quality_report(db, variant_id)


@router.post("/tests/{variant_id}/publish")
async def publish_variant(
    variant_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_tests.publish_variant(db, admin.id, _ip(request), variant_id)


@router.post("/tests/{variant_id}/unpublish")
async def unpublish_variant(
    variant_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_tests.unpublish_variant(db, admin.id, _ip(request), variant_id)


@router.delete("/content")
async def reset_all_content(
    payload: ResetContent, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_tests.reset_all_content(db, admin, _ip(request), payload)


@router.get("/students")
async def students(search: str = "", _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await admin_students.list_students(db, search)


@router.patch("/students/{student_id}/active")
async def set_student_active(
    student_id: uuid.UUID, active: bool, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_students.set_student_active(db, admin.id, _ip(request), student_id, active)


@router.delete("/students/{student_id}/telegram", status_code=204)
async def admin_unlink_telegram(
    student_id: uuid.UUID, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    await admin_students.unlink_student_telegram(db, admin.id, _ip(request), student_id)


@router.get("/audit-log")
async def audit_log(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await admin_students.audit_log(db)


@router.get("/submissions/pending")
async def pending_submissions(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await admin_grading.pending_submissions(db)


@router.post("/attempt-answers/{answer_id}/grade")
async def grade_submission(
    answer_id: uuid.UUID, payload: GradeInput, request: Request,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    return await admin_grading.grade_submission(db, admin.id, _ip(request), answer_id, payload)


@router.get("/reports/attempts.xlsx")
async def export_attempts(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    output = await admin_reports.export_attempts_workbook(db)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=examflow-attempts.xlsx"},
    )
