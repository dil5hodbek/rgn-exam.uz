export const questionTypes = [
  "multiple_choice", "multi_select", "true_false", "true_false_not_given",
  "gap_fill", "dropdown_gap_fill", "short_answer", "error_correction",
  "matching_pairs", "matching_headings", "drag_and_drop", "sentence_ordering",
  "word_ordering", "table_completion", "listening", "reading",
  "vocabulary_exercise", "grammar_exercise", "writing",
  "speaking_prompt_placeholder", "rich_text_question",
];

export const choiceTypes = new Set(["multiple_choice", "multi_select", "dropdown_gap_fill"]);
export const binaryTypes = new Set(["true_false", "true_false_not_given"]);
export const manualTypes = new Set(["writing", "speaking_prompt_placeholder", "rich_text_question"]);
export const matchingTypes = new Set(["matching_pairs", "matching_headings", "drag_and_drop"]);

// Mirrors app/services/exercise_registry.py::DEFAULT_KIND_BY_TASK_TYPE — keep in sync.
export const DEFAULT_KIND_BY_TASK_TYPE: Record<string, string> = {
  multiple_choice: "multiple_choice",
  multi_select: "multiple_choice",
  true_false: "binary_choice",
  true_false_not_given: "binary_choice",
  matching_pairs: "matching",
  matching_headings: "matching_headings",
  sentence_ordering: "ordering",
  word_ordering: "ordering",
  gap_fill: "guided_input",
  error_correction: "correction",
  short_answer: "short_answer",
  writing: "long_text",
  rich_text_question: "long_text",
  speaking_prompt_placeholder: "long_text",
};

export function defaultKind(type: string) {
  return DEFAULT_KIND_BY_TASK_TYPE[type] ?? "rich_text";
}

export function typeHint(type: string) {
  if (binaryTypes.has(type)) return "Student selects a fixed True/False answer.";
  if (choiceTypes.has(type)) return "Add visible options, then select the correct option.";
  if (matchingTypes.has(type)) return "Add reusable words or matching labels as options.";
  if (manualTypes.has(type)) return "Long response. The teacher reviews this answer manually.";
  if (type.includes("ordering")) return "Add words or sentences in their correct order.";
  return "Student types the answer into the blank or answer field.";
}

export function parseAnswer(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed === "true" || trimmed === "false") {
    try { return JSON.parse(trimmed); } catch { return value; }
  }
  return value;
}

export function answerText(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

// Detects an inline "word1 / word2" alternative pair inside a prompt, e.g.
// "Do you think you can deal with / at this on your own?" — used to
// auto-suggest options for inline_alternatives questions in the admin UI.
export function detectAlternativeOptions(prompt: string): [string, string] | null {
  const match = prompt.match(/([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)/u);
  if (!match) return null;
  return [match[1], match[2]];
}
