"use client";

import { Input } from "@/components/ui/input";
import {
  answerText, binaryTypes, choiceTypes, detectAlternativeOptions, manualTypes, matchingTypes, typeHint,
} from "@/lib/question-types";

export type EditableQuestion = {
  prompt: string;
  options: string[];
  correct_answer: unknown;
  accepted_answers: unknown[];
  is_example: boolean;
  // Optional: only present for fully-materialized DB questions, not import drafts.
  points?: number;
  explanation?: string;
  case_sensitive?: boolean;
  normalize_spaces?: boolean;
};

export function QuestionFields({
  type, question, onChange,
}: {
  type: string;
  question: EditableQuestion;
  onChange: (changes: Partial<EditableQuestion>) => void;
}) {
  return <div className="space-y-4">
    <p className="rounded-xl bg-indigo-500/5 p-3 text-xs font-semibold leading-5 text-muted">{typeHint(type)}</p>
    <label className="block space-y-2 text-xs font-bold text-muted">Prompt
      <textarea
        className="min-h-32 w-full rounded-xl border border-line bg-canvas p-3 text-sm text-ink outline-none focus:border-brand"
        value={question.prompt}
        onChange={(event) => {
          const prompt = event.target.value;
          // Auto-suggest inline "word1 / word2" alternatives as options once,
          // only while options are still empty — the admin can freely edit afterward.
          if (choiceTypes.has(type) && question.options.length === 0) {
            const detected = detectAlternativeOptions(prompt);
            if (detected) { onChange({ prompt, options: detected }); return; }
          }
          onChange({ prompt });
        }}
      />
    </label>
    {(choiceTypes.has(type) || matchingTypes.has(type) || type.includes("ordering")) && <label className="block space-y-2 text-xs font-bold text-muted">Options · one per line
      <textarea
        className="min-h-24 w-full rounded-xl border border-line bg-canvas p-3 text-sm text-ink"
        value={question.options.join("\n")}
        onChange={(event) => onChange({ options: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })}
      />
    </label>}
    {!manualTypes.has(type) && (binaryTypes.has(type)
      ? <label className="block space-y-2 text-xs font-bold text-muted">Correct answer
          <select
            className="h-12 w-full rounded-xl border border-line bg-canvas px-3 text-sm text-ink"
            value={answerText(question.correct_answer)}
            onChange={(event) => onChange({ correct_answer: event.target.value })}
          >
            {(type === "true_false_not_given" ? ["", "True", "False", "Not Given"] : ["", "True", "False"]).map((value) =>
              <option key={value} value={value}>{value || "Select answer"}</option>)}
          </select>
        </label>
      : choiceTypes.has(type) && type !== "multi_select"
        ? <label className="block space-y-2 text-xs font-bold text-muted">Correct answer
            <select
              className="h-12 w-full rounded-xl border border-line bg-canvas px-3 text-sm text-ink"
              value={answerText(question.correct_answer)}
              onChange={(event) => onChange({ correct_answer: event.target.value })}
            >
              <option value="">Select answer</option>
              {question.options.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        : <label className="block space-y-2 text-xs font-bold text-muted">
            Correct answer{type.includes("ordering") || type === "multi_select" ? " · JSON array" : ""}
            <Input value={answerText(question.correct_answer)} onChange={(event) => onChange({ correct_answer: event.target.value })} />
          </label>)}
    {!manualTypes.has(type) && <label className="block space-y-2 text-xs font-bold text-muted">Alternative accepted answers · one per line
      <textarea
        className="min-h-20 w-full rounded-xl border border-line bg-canvas p-3 text-sm text-ink"
        value={question.accepted_answers.map(String).join("\n")}
        onChange={(event) => onChange({ accepted_answers: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })}
      />
    </label>}
    {question.explanation !== undefined && <label className="block space-y-2 text-xs font-bold text-muted">Explanation
      <textarea
        className="min-h-20 w-full rounded-xl border border-line bg-canvas p-3 text-sm text-ink"
        value={question.explanation ?? ""}
        onChange={(event) => onChange({ explanation: event.target.value })}
      />
    </label>}
    {question.points !== undefined && <label className="block space-y-2 text-xs font-bold text-muted">Points
      <Input type="number" min="0.1" step="0.1" value={question.points} onChange={(event) => onChange({ points: Number(event.target.value) })} />
    </label>}
    <label className="flex items-center justify-between text-sm font-semibold text-ink">Example item
      <input type="checkbox" checked={question.is_example} onChange={(event) => onChange({ is_example: event.target.checked })} className="h-4 w-4 accent-indigo-600" />
    </label>
    {question.case_sensitive !== undefined && <label className="flex items-center justify-between text-sm font-semibold text-ink">Case sensitive
      <input type="checkbox" checked={question.case_sensitive} onChange={(event) => onChange({ case_sensitive: event.target.checked })} className="h-4 w-4 accent-indigo-600" />
    </label>}
    {question.normalize_spaces !== undefined && <label className="flex items-center justify-between text-sm font-semibold text-ink">Normalize spaces
      <input type="checkbox" checked={question.normalize_spaces} onChange={(event) => onChange({ normalize_spaces: event.target.checked })} className="h-4 w-4 accent-indigo-600" />
    </label>}
  </div>;
}
