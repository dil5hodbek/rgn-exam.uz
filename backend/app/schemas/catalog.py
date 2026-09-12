import uuid
from typing import Any

from pydantic import BaseModel


class LevelOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    published_tests: int


class ExamTypeOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    level_id: uuid.UUID | None


class VariantSummaryOut(BaseModel):
    id: uuid.UUID
    title: str
    variant_number: int
    time_limit_minutes: int
    passing_percentage: int
    retake_allowed: bool


class MediaOut(BaseModel):
    id: uuid.UUID
    url: str
    mime_type: str
    file_name: str


class StudentQuestionOut(BaseModel):
    """The student-facing view of a question: no correct_answer/accepted_answers,
    so the answer key never leaks to the client for real (non-example) questions."""
    id: uuid.UUID
    prompt: str
    options: list[Any]
    points: float
    is_example: bool
    example_answer: Any | None
    order_index: int


class StudentTaskOut(BaseModel):
    id: uuid.UUID
    type: str
    title: str
    instructions: str
    passage_html: str | None
    audio_replay_limit: int | None
    interaction: dict[str, Any]
    media: MediaOut | None
    questions: list[StudentQuestionOut]


class StudentSectionOut(BaseModel):
    id: uuid.UUID
    title: str
    order_index: int
    tasks: list[StudentTaskOut]


class TestDetailOut(BaseModel):
    id: uuid.UUID
    title: str
    instructions: str
    time_limit_minutes: int
    passing_percentage: int
    review_allowed: bool
    sections: list[StudentSectionOut]
