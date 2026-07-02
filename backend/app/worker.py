import asyncio
import uuid
from pathlib import Path

from celery import Celery

from app.core.config import settings
from app.core.database import SessionLocal
from app.importer import ImportPipeline
from app.models import ImportJob, ImportStatus

celery = Celery("examflow", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.task_track_started = True


async def _run_import(job_id: str) -> dict:
    async with SessionLocal() as db:
        job = await db.get(ImportJob, uuid.UUID(job_id))
        if not job:
            return {"error": "Import job not found."}
        job.status, job.progress = ImportStatus.PROCESSING, 10
        await db.commit()
        try:
            result = ImportPipeline(Path(job.source_path)).run()
            job.manifest = {"files": result["manifest"]}
            job.warnings = result["warnings"]
            job.result = {"summary": result["summary"], "tests": result["tests"]}
            job.status, job.progress = ImportStatus.NEEDS_REVIEW, 100
        except Exception as exc:
            job.status = ImportStatus.FAILED
            job.warnings = [str(exc)]
        await db.commit()
        return job.result


@celery.task(name="imports.process")
def import_package(job_id: str) -> dict:
    return asyncio.run(_run_import(job_id))
