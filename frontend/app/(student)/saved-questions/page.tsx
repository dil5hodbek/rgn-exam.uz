"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, X } from "lucide-react";
import { api } from "@/lib/api";

type Saved = {
  id: string;
  question_id: string;
  prompt: string;
  options: unknown[];
  correct_answer: unknown;
  student_answer: unknown;
  is_correct: boolean | null;
  exercise_type: string;
  test_title: string;
  level: string;
  exam_type: string;
};

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default function SavedQuestions() {
  const [rows, setRows] = useState<Saved[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Saved[]>("/me/saved-questions")
      .then(setRows)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load saved questions."));
  }, []);

  return <div className="mx-auto max-w-4xl p-4 sm:p-8">
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/10 text-brand"><Bookmark className="h-5 w-5" /></span>
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Review</p>
        <h1 className="text-2xl font-extrabold text-ink">Saved questions</h1>
      </div>
    </div>
    <p className="mt-2 text-sm text-muted">Questions you bookmarked (flagged) while taking tests. Tap the flag on any question during a test to save it here.</p>

    {error && <p className="mt-6 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}

    {rows === null && !error && <div className="mt-8 grid place-items-center py-16"><span className="h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-brand" /></div>}

    {rows !== null && rows.length === 0 && <div className="mt-8 rounded-3xl border border-dashed border-line bg-canvas p-10 text-center">
      <Bookmark className="mx-auto h-8 w-8 text-muted" />
      <p className="mt-3 text-sm font-semibold text-ink">No saved questions yet</p>
      <p className="mt-1 text-sm text-muted">While taking a test, tap the flag icon on a question to save it for review.</p>
    </div>}

    {rows !== null && rows.length > 0 && <div className="mt-6 space-y-3">
      {rows.map((row) => <article key={row.id} className="rounded-2xl border border-line bg-canvas p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-brand">{row.level} · {row.exam_type}</span>
          <span className="rounded-full bg-surface px-2.5 py-1 text-muted">{row.test_title}</span>
          <span className="rounded-full bg-surface px-2.5 py-1 text-muted">{row.exercise_type}</span>
          {row.is_correct === true && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-600"><Check className="h-3 w-3" /> Correct</span>}
          {row.is_correct === false && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-red-600"><X className="h-3 w-3" /> Incorrect</span>}
        </div>
        <p className="mt-3 font-bold leading-7 text-ink">{row.prompt || <span className="italic text-muted">(no prompt)</span>}</p>
        {Array.isArray(row.options) && row.options.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
          {row.options.map((option, index) => {
            const value = typeof option === "string" ? option : String(option);
            const isCorrect = row.correct_answer != null && (Array.isArray(row.correct_answer) ? row.correct_answer.map(String).includes(value) : String(row.correct_answer) === value);
            return <span key={index} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${isCorrect ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "border-line bg-surface text-ink"}`}>{value}</span>;
          })}
        </div>}
        <div className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          <p className="text-muted">Your answer: <span className="font-semibold text-ink">{answerText(row.student_answer)}</span></p>
          {row.correct_answer != null && <p className="text-muted">Correct answer: <span className="font-semibold text-emerald-600">{answerText(row.correct_answer)}</span></p>}
        </div>
      </article>)}
    </div>}
  </div>;
}
