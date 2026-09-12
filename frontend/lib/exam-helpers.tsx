import type { ReactNode } from "react";

export type AnswerValue = string | string[] | Record<string, string> | null;
export type Media = { url: string; mime_type: string; file_name: string };
export type ApiQuestion = {
  id: string; prompt: string; options: Array<string | { value: string; label: string }>; points: number;
  is_example: boolean; example_answer?: AnswerValue; order_index?: number;
};
export type ApiTask = {
  id: string; type: string; title: string; instructions: string;
  passage_html?: string; media?: Media; questions: ApiQuestion[];
  audio_replay_limit?: number | null;
  interaction?: {
    kind?: "word_bank" | "matching" | "matching_headings" | "inline_alternatives" | "ordering" | "cloze_passage"
      | "binary_choice" | "multiple_choice" | "guided_input" | "correction"
      | "short_answer" | "long_text" | "rich_text" | "gap_match";
    options?: string[] | { value: string; label: string }[];
    words?: string[];
    reuse_options?: boolean;
    template?: string;
    example_values?: Record<string, string>;
    items?: Array<{ number: number; before: string; options: string[]; after: string }>;
    min_words?: number | null;
    max_words?: number | null;
    manual_review?: boolean;
    word_box?: string[];
  };
};
export type ApiSection = { id: string; title: string; tasks: ApiTask[] };
export type TestDetail = {
  id: string; title: string; instructions: string;
  time_limit_minutes: number; sections: ApiSection[];
};
export type Exercise = ApiTask & { section: ApiSection };
export type AttemptState = {
  id: string; elapsed_seconds: number;
  answers: { question_id: string; answer: AnswerValue; flagged: boolean }[];
  checked_task_ids?: string[];
  answers_updated_at?: string | null;
};
export type ExerciseResult = Record<string, boolean | null>;

export function hasAnswer(value: AnswerValue | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

export function textAnswer(value: AnswerValue | undefined) {
  return typeof value === "string" ? value : "";
}

// Writing/task instructions are stored as plain text with "- " bullet lines
// (e.g. "Write about:\n - how often you do it,\n - who you do it with").
// Render those as an actual bulleted list instead of one run-on paragraph so
// students can see each required point at a glance.
export function renderInstructionBlocks(text: string, headingFirstLine: boolean) {
  const lines = text.split(/\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let firstParagraph = true;
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-2 list-disc space-y-1.5 pl-5 marker:text-brand">
        {list.map((item, index) => <li key={index} className="leading-relaxed">{item}</li>)}
      </ul>,
    );
    list = [];
  };
  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    const bullet = trimmed.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flushList();
    if (!trimmed) return;
    const isHeading = headingFirstLine && firstParagraph;
    firstParagraph = false;
    blocks.push(
      <p key={`p-${index}`} className={isHeading ? "text-lg font-extrabold leading-8 text-ink sm:text-[21px] sm:leading-9" : "leading-relaxed"}>
        {trimmed}
      </p>,
    );
  });
  flushList();
  return blocks;
}

export function answerChoices(exercise: Exercise, question: ApiQuestion) {
  const context = `${exercise.type} ${exercise.instructions}`.toLowerCase();
  if (context.includes("true_false_not_given") || /true.+false.+not given/.test(context)) {
    return ["True", "False", "Not Given"];
  }
  if (context.includes("true_false") || /true.+false|true\s*\(t\).+false\s*\(f\)/.test(context)) {
    return ["True", "False"];
  }

  let choices = (question.options ?? [])
    .map((option) => (typeof option === "string" ? option : option.label).replace(/\s*\|\s*$/, "").trim())
    .filter(Boolean);
  if (choices.length === 1 && /\s+[b-d]\s+/i.test(choices[0])) {
    choices = choices[0].split(/\s+[b-d]\s+/i).map((option) => option.trim()).filter(Boolean);
  }
  if (!choices.length && /choose (?:the )?correct alternative/i.test(exercise.instructions)) {
    const alternative = question.prompt.match(/([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)/u);
    if (alternative) choices = [alternative[1], alternative[2]];
  }
  return choices;
}

// Options arrange themselves by content: short choices sit side by side on
// one row, medium ones in two columns, long ones stack full-width — so the
// reading order is always natural (a, b, c…).
export function choiceGridClass(choices: string[]) {
  const longest = Math.max(0, ...choices.map((choice) => choice.length));
  if (longest <= 24) {
    if (choices.length === 2) return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-2";
    if (choices.length === 3) return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-3";
    if (choices.length === 4) return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-4";
    return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-3";
  }
  if (longest <= 42) return "grid gap-2.5 grid-cols-1 sm:grid-cols-2";
  return "grid gap-2.5 grid-cols-1";
}

export function interactionOptions(exercise: Exercise) {
  const options = exercise.interaction?.options ?? [];
  return options.map((option) => typeof option === "string"
    ? { value: option, label: option }
    : option);
}

export function inlineAlternative(question: ApiQuestion) {
  const parsedOptions = question.options
    .map((option) => typeof option === "string" ? option : option.label)
    .filter(Boolean);
  if (parsedOptions.length === 2 && question.prompt.includes("/")) {
    const slash = question.prompt.indexOf("/");
    const leftStart = question.prompt.lastIndexOf(parsedOptions[0], slash);
    const rightStart = question.prompt.indexOf(parsedOptions[1], slash);
    if (leftStart >= 0 && rightStart >= 0) {
      return {
        before: question.prompt.slice(0, leftStart),
        first: parsedOptions[0],
        second: parsedOptions[1],
        after: question.prompt.slice(rightStart + parsedOptions[1].length),
      };
    }
  }
  const match = question.prompt.match(/^(.*?)([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)(.*)$/u);
  if (!match) return null;
  return { before: match[1], first: match[2], second: match[3], after: match[4] };
}

export function orderingTokens(question: ApiQuestion) {
  if (question.options?.length) return question.options.map((option) =>
    typeof option === "string" ? option : option.label
  );
  const bracketed = [...question.prompt.matchAll(/\(([^)]+)\)/g)];
  const source = bracketed.at(-1)?.[1] ?? "";
  return source.split(/\s*\/\s*|\s*,\s*/).map((token) => token.trim()).filter(Boolean);
}

export function scorableQuestions(questions: ApiQuestion[]) {
  return questions.filter((question) => !question.is_example);
}

export function exampleAnswerText(question: ApiQuestion) {
  const value = question.example_answer;
  if (Array.isArray(value)) return value.map(String).join(", ");
  return value == null ? "" : String(value);
}
