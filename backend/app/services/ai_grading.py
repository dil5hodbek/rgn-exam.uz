"""Low-cost AI grading for open writing/speaking answers.

One short LLM call per answer: a compact prompt in, a tiny JSON verdict out
({"score", "feedback"}). Reuses the same OpenRouter/Anthropic client the docx
import already configures, so no new keys or dependencies. Empty answers never
reach the model (they score 0 for free)."""
import logging
from typing import Any

from app.services.docx_import import _complete_async, _extract_json, ai_available

logger = logging.getLogger(__name__)

# Kept short on purpose — every extra token is money. Haiku-class models grade
# a 50-100 word answer for a fraction of a cent with this.
_GRADE_SYSTEM = (
    "You are a concise English writing examiner. Score the student's answer and "
    "give ONE short feedback sentence (max 20 words). Judge task completion, "
    "grammar, vocabulary range, and whether the length fits the guideline. "
    "Return ONLY strict JSON: {\"score\": <number>, \"feedback\": \"...\"}. "
    "score is 0..MAX where MAX is the maximum points given."
)


def word_count(text: str) -> int:
    return len(text.split()) if text and text.strip() else 0


async def ai_grade_text(
    instructions: str,
    prompt: str,
    answer: str,
    max_points: float,
    min_words: int | None = None,
    max_words: int | None = None,
) -> tuple[float, str] | None:
    """Grade one open answer. Returns (score, feedback) or None if the model
    is unavailable / fails (caller decides the fallback). Never called for an
    empty answer."""
    if not ai_available():
        return None
    text = (answer or "").strip()
    if not text:
        return None

    guide = ""
    if min_words or max_words:
        guide = f"\nLength guideline: {min_words or 0}-{max_words or '∞'} words."
    user = (
        f"MAX points: {max_points:g}.{guide}\n"
        f"Task: {instructions.strip()}\n"
        f"Prompt: {prompt.strip()}\n"
        f"Word count: {word_count(text)}\n"
        f"Student answer:\n{text[:4000]}"
    )

    # Tiny output cap: grading needs ~40 tokens, so reserve little credit and
    # skip long retry backoffs to keep submit snappy and cheap.
    raw = await _complete_async(_GRADE_SYSTEM, user, max_tokens=300, retries=2)
    data: dict[str, Any] | None = _extract_json(raw) if raw else None
    if not isinstance(data, dict) or "score" not in data:
        logger.warning("AI grading returned no usable verdict")
        return None
    try:
        score = float(data["score"])
    except (TypeError, ValueError):
        return None
    # Clamp into range so a hallucinated number can never award over the max.
    score = max(0.0, min(score, float(max_points)))
    feedback = str(data.get("feedback") or "").strip()[:600]
    return round(score, 2), feedback
