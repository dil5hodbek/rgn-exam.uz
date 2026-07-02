import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


QuestionType = Literal[
    "multiple_choice", "multi_select", "true_false", "true_false_not_given",
    "gap_fill", "dropdown_gap_fill", "short_answer", "error_correction",
    "matching_pairs", "matching_headings", "drag_and_drop", "sentence_ordering",
    "word_ordering", "table_completion", "listening", "reading",
    "vocabulary_exercise", "grammar_exercise", "writing",
    "speaking_prompt_placeholder", "rich_text_question",
]


class QuestionInput(BaseModel):
    prompt: str = Field(min_length=1)
    options: list[Any] = Field(default_factory=list)
    correct_answer: Any | None = None
    accepted_answers: list[Any] = Field(default_factory=list)
    points: float = Field(default=1, gt=0)
    explanation: str | None = None
    is_example: bool = False
    case_sensitive: bool = False
    normalize_spaces: bool = True


class AnswerSave(BaseModel):
    question_id: uuid.UUID
    answer: Any | None = None
    flagged: bool = False


class AnswerBatch(BaseModel):
    answers: list[AnswerSave] = Field(max_length=500)


class GradeInput(BaseModel):
    points_awarded: float = Field(ge=0)
    feedback: str = ""
    rubric_scores: dict[str, float] = Field(default_factory=dict)


class VariantCreate(BaseModel):
    level_id: uuid.UUID
    exam_type_id: uuid.UUID
    title: str = Field(min_length=2, max_length=180)
    variant_number: int = Field(ge=1)
    time_limit_minutes: int = Field(ge=1, le=300)
    passing_percentage: int = Field(ge=0, le=100)
    retake_allowed: bool = False
    review_allowed: bool = True


class VariantUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    instructions: str = ""
    time_limit_minutes: int = Field(ge=1, le=300)
    passing_percentage: int = Field(ge=0, le=100)
    retake_allowed: bool = False
    review_allowed: bool = True


class TaskUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    instructions: str = ""
    type: QuestionType
    passage_html: str | None = None
    audio_replay_limit: int | None = Field(default=None, ge=1, le=20)
    interaction: dict[str, Any] | None = None


class SectionInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class TaskCreate(TaskUpdate):
    pass


class QuestionCreate(QuestionInput):
    pass


class ImportExerciseUpdate(BaseModel):
    question_type: str | None = None
    interaction: dict[str, Any] | None = None
    instructions: str | None = None


class ImportQuestionUpdate(BaseModel):
    prompt: str | None = None
    options: list[Any] | None = None
    correct_answer: Any | None = None
    accepted_answers: list[Any] | None = None
    is_example: bool | None = None
