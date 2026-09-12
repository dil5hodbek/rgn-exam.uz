"""Queues AI DOCX imports onto the Celery worker and reports job status.

The actual parsing/persistence runs in app.tasks.import_tasks — this module
only creates the ImportJob row and enqueues the task.
"""
import base64
import uuid

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ImportJob, ImportStatus, TestVariant
from app.tasks.import_tasks import run_answers_import_task, run_docx_import_task

MAX_IMPORT_BYTES = 20 * 1024 * 1024


async def _read_docx_upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(415, "Upload a Word .docx file.")
    data = await file.read()
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "The document is too large (max 20 MB).")
    return data


async def queue_docx_import(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    variant_id: uuid.UUID, file: UploadFile,
) -> dict:
    data = await _read_docx_upload(file)
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")

    job = ImportJob(
        file_name=file.filename or "import.docx",
        source_path="",
        status=ImportStatus.QUEUED,
        manifest={"variant_id": str(variant_id), "job_type": "docx_import"},
        created_by=admin_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    run_docx_import_task.delay(
        str(job.id), str(variant_id), base64.b64encode(data).decode(), str(admin_id), ip_address,
    )
    return {"job_id": job.id, "status": job.status}


async def queue_answers_import(
    db: AsyncSession, admin_id: uuid.UUID, variant_id: uuid.UUID, file: UploadFile,
) -> dict:
    data = await _read_docx_upload(file)
    variant = await db.get(TestVariant, variant_id)
    if not variant:
        raise HTTPException(404, "Test variant not found.")

    job = ImportJob(
        file_name=file.filename or "answers.docx",
        source_path="",
        status=ImportStatus.QUEUED,
        manifest={"variant_id": str(variant_id), "job_type": "answers_import"},
        created_by=admin_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    run_answers_import_task.delay(str(job.id), str(variant_id), base64.b64encode(data).decode(), str(admin_id))
    return {"job_id": job.id, "status": job.status}


async def get_import_job(db: AsyncSession, job_id: uuid.UUID) -> dict:
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(404, "Import job not found.")
    return {
        "id": job.id, "status": job.status, "progress": job.progress,
        "file_name": job.file_name, "warnings": job.warnings, "result": job.result,
        "created_at": job.created_at,
    }
