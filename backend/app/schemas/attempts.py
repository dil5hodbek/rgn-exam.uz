import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models import AttemptStatus


class AnswerStateOut(BaseModel):
    question_id: uuid.UUID
    answer: Any | None
    flagged: bool


class AttemptStateOut(BaseModel):
    id: uuid.UUID
    status: AttemptStatus
    started_at: datetime
    elapsed_seconds: int
    answers_updated_at: datetime | None
    answers: list[AnswerStateOut]
    checked_task_ids: list[str]


class SaveAnswersOut(BaseModel):
    saved: int
    saved_at: datetime


class CheckResultItemOut(BaseModel):
    question_id: uuid.UUID
    is_correct: bool
    is_example: bool


class CheckExerciseOut(BaseModel):
    task_id: uuid.UUID
    results: list[CheckResultItemOut]
    checked: bool


class SubmitResultOut(BaseModel):
    status: AttemptStatus
    score: float
    max_score: float
    percentage: float


class HistoryItemOut(BaseModel):
    id: uuid.UUID
    test_variant_id: uuid.UUID
    status: AttemptStatus
    score: float
    max_score: float
    percentage: float
    started_at: datetime
    submitted_at: datetime | None
    time_spent_seconds: int
    title: str
    variant_number: int
    level: str
    level_slug: str
    exam_type: str
    exam_type_slug: str


class SavedQuestionOut(BaseModel):
    id: uuid.UUID
    attempt_id: uuid.UUID
    question_id: uuid.UUID
    prompt: str
    options: list[Any]
    correct_answer: Any | None
    student_answer: Any | None
    is_correct: bool | None
    exercise_type: str
    test_title: str
    level: str
    exam_type: str


class TeacherReviewOut(BaseModel):
    id: uuid.UUID
    attempt_id: uuid.UUID
    test_title: str
    task_title: str
    instructions: str
    prompt: str
    answer: Any | None
    max_points: float
    graded: bool
    points_awarded: float | None
    feedback: str | None
    annotations: list[Any]
    graded_at: datetime | None
    submitted_at: datetime | None
