from app.models import Question


def renumber_questions(questions: list[Question]) -> None:
    """Renumber a task's questions to 1..N, in their current order.

    Numbering is always scoped to a single Task (exercise) — it never
    reflects a global/cross-exercise counter. Call this after any insert,
    delete, or reorder so gaps never appear in order_index.
    """
    for index, question in enumerate(sorted(questions, key=lambda item: item.order_index), start=1):
        question.order_index = index
