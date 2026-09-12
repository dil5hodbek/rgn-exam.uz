from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "examflow",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # DOCX import calls an external AI API and can legitimately take a while.
    task_time_limit=15 * 60,
    task_soft_time_limit=12 * 60,
)
celery_app.autodiscover_tasks(["app.tasks"])
