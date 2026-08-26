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


class TeacherCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    phone_number: str
    password: str = Field(min_length=1, max_length=128)


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


class AnnotationInput(BaseModel):
    """A teacher-marked error inside the student's answer text: character
    offsets into the plain answer string plus an optional correction note."""
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    comment: str = ""


class GradeInput(BaseModel):
    points_awarded: float = Field(ge=0)
    feedback: str = ""
    rubric_scores: dict[str, float] = Field(default_factory=dict)
    annotations: list[AnnotationInput] = Field(default_factory=list, max_length=100)


class ResetContent(BaseModel):
    password: str


class ReorderTasks(BaseModel):
    task_ids: list[uuid.UUID]


class VariantCreate(BaseModel):
    level_id: uuid.UUID
    exam_type_id: uuid.UUID
    title: str = Field(min_length=2, max_length=180)
    variant_number: int = Field(ge=1)
    time_limit_minutes: int = Field(ge=1, le=300)
    passing_percentage: int = Field(ge=0, le=100)
    retake_allowed: bool = True
    review_allowed: bool = True


class VariantUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    instructions: str = ""
    time_limit_minutes: int = Field(ge=1, le=300)
    passing_percentage: int = Field(ge=0, le=100)
    retake_allowed: bool = True
    review_allowed: bool = True


class TaskUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    instructions: str = ""
    type: QuestionType
    passage_html: str | None = None
    audio_replay_limit: int | None = Field(default=None, ge=1, le=20)
    interaction: dict[str, Any] | None = None
    media_asset_id: uuid.UUID | None = None


class SectionInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class TaskQuestionInput(BaseModel):
    """A single question sent inline when the exercise builder saves a whole
    Task at once. Lenient on purpose (examples may be blank, composite rows
    carry array answers) — the real gate is validate_task_payload()."""
    order_index: int | None = None
    prompt: str = ""
    options: list[Any] = Field(default_factory=list)
    correct_answer: Any | None = None
    accepted_answers: list[Any] = Field(default_factory=list)
    points: float = Field(default=1, ge=0)
    explanation: str | None = None
    is_example: bool = False
    case_sensitive: bool = False
    normalize_spaces: bool = True


class TaskCreate(TaskUpdate):
    # When present the exercise builder is submitting the full structure in one
    # request; the endpoint validates it against QUESTION_TEMPLATES[template_key]
    # and persists the questions together with the task.
    template_key: str | None = None
    questions: list[TaskQuestionInput] = Field(default_factory=list)


class QuestionCreate(QuestionInput):
    pass
