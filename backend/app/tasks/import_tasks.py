"""Celery tasks that run the AI-assisted DOCX import off the request thread.

These wrap the same persistence logic the admin endpoints used to run inline
(app.api.v1.admin._persist_new_task). Imports of admin/schemas modules are
deferred inside the task bodies to avoid a circular import at module load
time (admin.py enqueues these tasks, these tasks call back into admin.py).
"""
import asyncio
import base64
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.core.celery_app import celery_app
from app.core.config import settings
from app.models import ImportJob, ImportStatus, Section, Task, TestVariant

logger = logging.getLogger(__name__)


def _new_session_factory():
    """Celery's prefork worker keeps the process alive across tasks, but each
    task runs its own asyncio.run() loop. asyncpg's pool binds to the loop it
    was first used on, so the module-level engine from app.core.database
    (created at import time, before any task's loop exists) breaks on the
    second task with "attached to a different loop". Creating a fresh engine
    per task avoids that; it's disposed when the task's loop closes."""
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


@celery_app.task(name="import.run_docx_import")
def run_docx_import_task(job_id: str, variant_id: str, file_b64: str, admin_id: str, ip_address: str | None) -> None:
    asyncio.run(_run_docx_import(job_id, variant_id, base64.b64decode(file_b64), admin_id, ip_address))


@celery_app.task(name="import.run_answers_import")
def run_answers_import_task(job_id: str, variant_id: str, file_b64: str, admin_id: str) -> None:
    asyncio.run(_run_answers_import(job_id, variant_id, base64.b64decode(file_b64), admin_id))


async def _run_docx_import(job_id: str, variant_id: str, data: bytes, admin_id: str, ip_address: str | None) -> None:
    engine, SessionLocal = _new_session_factory()
    try:
        await _run_docx_import_body(job_id, variant_id, data, admin_id, ip_address, SessionLocal)
    finally:
        await engine.dispose()


async def _run_docx_import_body(job_id, variant_id, data, admin_id, ip_address, SessionLocal) -> None:
    from app.schemas.content import TaskCreate
    from app.services.admin_content import persist_new_task
    from app.services.docx_import import ai_available, ai_import_document, build_task_payloads

    async with SessionLocal() as db:
        job = await db.get(ImportJob, uuid.UUID(job_id))
        if not job:
            logger.warning("Import job %s vanished before processing.", job_id)
            return
        job.status = ImportStatus.PROCESSING
        await db.commit()
        try:
            if not ai_available():
                raise ValueError("AI import needs OPENROUTER_API_KEY or ANTHROPIC_API_KEY to be configured.")
            variant = await db.get(
                TestVariant, uuid.UUID(variant_id), options=[selectinload(TestVariant.sections)]
            )
            if not variant:
                raise ValueError("Test variant not found.")

            exercises = await ai_import_document(data)
            payloads, warnings = build_task_payloads(exercises)
            if not payloads:
                raise ValueError("No exercises could be extracted from this document.")

            section = variant.sections[0] if variant.sections else None
            if not section:
                section = Section(test_variant_id=variant.id, title="Exercises", order_index=1)
                db.add(section)
                await db.flush()

            created = []
            for payload in payloads:
                try:
                    result = await persist_new_task(
                        db, section, TaskCreate(**payload), uuid.UUID(admin_id), ip_address,
                    )
                    created.append({
                        "id": str(result["id"]), "title": result["title"],
                        "type": result["type"], "questions": len(result["questions"]),
                    })
                except Exception:
                    await db.rollback()
                    logger.warning("Import job %s: could not save task %s", job_id, payload["title"], exc_info=True)
                    warnings.append(f"“{payload['title']}” was skipped: could not be saved.")

            if not created:
                job.status = ImportStatus.FAILED
                job.result = {"message": "No exercises could be imported.", "errors": warnings}
            else:
                job.status = ImportStatus.COMPLETED
                job.result = {"created": len(created), "exercises": created}
            job.progress = 100
            job.warnings = warnings
        except Exception as exc:
            logger.exception("Import job %s failed", job_id)
            job.status = ImportStatus.FAILED
            job.result = {"message": str(exc)}
            job.progress = 100
        await db.commit()


async def _run_answers_import(job_id: str, variant_id: str, data: bytes, admin_id: str) -> None:
    engine, SessionLocal = _new_session_factory()
    try:
        await _run_answers_import_body(job_id, variant_id, data, admin_id, SessionLocal)
    finally:
        await engine.dispose()


async def _run_answers_import_body(job_id, variant_id, data, admin_id, SessionLocal) -> None:
    from app.services.audit import write_audit
    from app.services.docx_import import _extract_lines, ai_available, ai_match_answers, normalise_answer

    async with SessionLocal() as db:
        job = await db.get(ImportJob, uuid.UUID(job_id))
        if not job:
            logger.warning("Import job %s vanished before processing.", job_id)
            return
        job.status = ImportStatus.PROCESSING
        await db.commit()
        try:
            if not ai_available():
                raise ValueError("AI import needs OPENROUTER_API_KEY or ANTHROPIC_API_KEY to be configured.")
            variant = await db.get(
                TestVariant, uuid.UUID(variant_id),
                options=[selectinload(TestVariant.sections).selectinload(Section.tasks).selectinload(Task.questions)],
            )
            if not variant:
                raise ValueError("Test variant not found.")

            key_lines = _extract_lines(data)
            if not key_lines:
                raise ValueError("The answer key document is empty.")

            manual_types = {"writing", "speaking_prompt_placeholder"}
            letter = lambda i: chr(97 + i)  # noqa: E731

            structure: list[str] = [f"TEST: {variant.title} (variant {variant.variant_number})"]
            code_map: dict[str, tuple] = {}
            tasks = [
                t for section in sorted(variant.sections, key=lambda s: s.order_index)
                for t in sorted(section.tasks, key=lambda t: t.order_index or 0)
            ]
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
                    structure.append(
                        "  note: rows starting with 'Reply ·' take the LETTER of the matching reply; "
                        "other rows take the word from the box."
                    )
                for qi, question in enumerate(sorted(task.questions, key=lambda q: q.order_index or 0), start=1):
                    code = f"e{ti}q{qi}"
                    code_map[code] = (task, question)
                    line = f"  {code}: {question.prompt}"
                    if question.options:
                        line += " | options: " + "  ".join(f"{letter(i)}) {o}" for i, o in enumerate(question.options))
                    structure.append(line)

            matches = await ai_match_answers("\n".join(structure), "\n".join(key_lines))
            if not matches:
                raise ValueError("The AI could not match any answers from this document.")

            updated = 0
            warnings: list[str] = []
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
                updated += 1

            unanswered = [
                f"e{ti}q{qi}"
                for ti, task in enumerate(tasks, start=1) if task.type not in manual_types
                for qi, question in enumerate(sorted(task.questions, key=lambda q: q.order_index or 0), start=1)
                if f"e{ti}q{qi}" not in {m["code"] for m in matches} and not question.is_example
            ]
            if unanswered:
                warnings.append(
                    f"No answer found in the key for: {', '.join(unanswered[:25])}"
                    + (f" (+{len(unanswered) - 25} more)" if len(unanswered) > 25 else "")
                )

            await write_audit(
                db, uuid.UUID(admin_id), "test.import_answers", "TestVariant", variant_id,
                {"updated": updated}, None,
            )
            job.status = ImportStatus.COMPLETED
            job.progress = 100
            job.warnings = warnings
            job.result = {"updated": updated}
        except Exception as exc:
            logger.exception("Import job %s failed", job_id)
            job.status = ImportStatus.FAILED
            job.result = {"message": str(exc)}
            job.progress = 100
        await db.commit()
