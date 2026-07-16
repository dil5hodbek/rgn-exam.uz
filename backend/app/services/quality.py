import re
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import ExamType, Level, Section, Task, TestVariant
from app.services.exercise_registry import EXERCISE_REGISTRY, MANUAL_TASK_TYPES, interaction_matches_type


async def quality_report(db: AsyncSession, variant_id: uuid.UUID) -> dict:
    """The single source of truth for "is this test variant good enough to
    publish" — shared by the admin publish/quality-check endpoints and every
    import path (web bulk-import commit, offline CLI import), so a test that
    passes here is the same bar everywhere, and nothing gets auto-published
    through one path that would be rejected through another.
    """
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
            # A listening exercise may carry "Recording N" in its title OR its
            # instructions — either way it must ship with the audio.
            if re.search(r"\brecording\s*\d+", f"{task.title} {task.instructions}", re.I) and not task.media_asset_id:
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
                # Example items are pre-filled and shown for reference — the
                # template placing them inline is a bonus, not a requirement.
                # Every *scored* blank, however, must have exactly one placeholder.
                scored = [str(q.order_index) for q in active_questions if not q.is_example]
                allowed = {str(q.order_index) for q in active_questions}
                if (
                    not template.strip()
                    or len(placeholders) != len(set(placeholders))
                    or not set(scored).issubset(placeholders)
                    or not set(placeholders).issubset(allowed)
                ):
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
