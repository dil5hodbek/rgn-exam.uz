// Shared by the result page and the saved-questions page: puts the student's
// answer into the blank of a gap-fill prompt, coloured by whether it was right.

export type AnswerTone = "wrong" | "right" | "neutral";

// Blanks in imported prompts are written as runs of underscores or dots.
const BLANK = /_{2,}|…+|\.{4,}/g;

/** Splits the student's answer into one value per blank when it can, so each
 * blank shows its own word; otherwise the whole answer goes in the first blank. */
function answerParts(value: unknown, blanks: number): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(String);
  const text = String(value);
  if (blanks > 1) {
    const split = text.split(",").map((part) => part.trim());
    if (split.length === blanks) return split;
  }
  return [text];
}

/** Returns the prompt with the answer in its blank(s), or null when the prompt has no blank. */
export function PromptWithAnswer({ prompt, answer, tone, empty }: { prompt: string; answer: unknown; tone: AnswerTone; empty: string }) {
  const pieces = prompt.split(BLANK);
  if (pieces.length < 2) return null;
  const parts = answerParts(answer, pieces.length - 1);
  const word = tone === "wrong"
    ? "bg-rose-100 text-rose-700 decoration-rose-400 dark:bg-rose-500/20 dark:text-rose-200"
    : tone === "right"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
      : "bg-surface text-ink";
  return <>{pieces.map((piece, index) => <span key={index}>{piece}{index < pieces.length - 1 && <span className={`mx-0.5 rounded-md px-1.5 py-0.5 font-extrabold underline decoration-2 underline-offset-4 [-webkit-box-decoration-break:clone] [box-decoration-break:clone] ${word}`}>{parts[index]?.trim() ? parts[index] : parts.length === 0 && index === 0 ? empty : "—"}</span>}</span>)}</>;
}

/** Card colours for a reviewed answer. */
export function reviewCardTone(isCorrect: boolean | null) {
  if (isCorrect === false) return "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10";
  if (isCorrect === true) return "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10";
  return "border-line";
}

/** Green pill holding the correct answer, placed at the card's bottom-right. */
export function CorrectAnswerPill({ text, label }: { text: string; label: string }) {
  return <div className="mt-1.5 flex justify-end">
    <span aria-label={label} className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-right text-sm font-extrabold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">{text}</span>
  </div>;
}
