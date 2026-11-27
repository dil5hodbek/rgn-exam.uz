"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { CorrectAnswerPill, PromptWithAnswer, reviewCardTone } from "@/lib/answer-review";

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
  const { t } = useLang();
  const [rows, setRows] = useState<Saved[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Saved[]>("/me/saved-questions")
      .then(setRows)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t("Saqlangan savollarni yuklab bo'lmadi.", "Unable to load saved questions.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="mx-auto max-w-4xl p-4 sm:p-8">
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-500/10 text-brand"><Bookmark className="h-5 w-5" /></span>
      <div>
        <p className="text-xs font-bold uppercase tracking-[.08em] text-brand">{t("Takrorlash", "Review")}</p>
        <h1 className="text-2xl font-extrabold text-ink">{t("Saqlangan savollar", "Saved questions")}</h1>
      </div>
    </div>

    {error && <p className="mt-6 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}

    {rows === null && !error && <div className="mt-8 grid place-items-center py-16"><span className="h-9 w-9 animate-spin rounded-full border-4 border-orange-100 border-t-brand" /></div>}

    {rows !== null && rows.length === 0 && <div className="mt-8 rounded-3xl border border-dashed border-line bg-canvas p-10 text-center">
      <Bookmark className="mx-auto h-8 w-8 text-muted" />
      <p className="mt-3 text-sm font-semibold text-ink">{t("Hali saqlangan savol yo'q", "No saved questions yet")}</p>
      <p className="mt-1 text-sm text-muted">{t("Test paytida bayroqchani bosing.", "Tap the flag during a test.")}</p>
    </div>}

    {rows !== null && rows.length > 0 && <div className="mt-6 space-y-3">
      {rows.map((row) => {
        const wrong = row.is_correct === false;
        const right = row.is_correct === true;
        const inline = row.prompt ? PromptWithAnswer({ prompt: row.prompt, answer: row.student_answer, tone: wrong ? "wrong" : right ? "right" : "neutral", empty: t("javob yo'q", "no answer") }) : null;
        const picked = (value: string) => row.student_answer != null && (Array.isArray(row.student_answer) ? row.student_answer.map(String).includes(value) : String(row.student_answer) === value);
        return <article key={row.id} className={`saved-question rounded-2xl border p-4 sm:p-5 ${reviewCardTone(row.is_correct)}`}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-orange-500/10 px-2.5 py-1 text-brand">{row.level} · {row.exam_type}</span>
            <span className="rounded-full bg-white/70 px-2.5 py-1 text-muted dark:bg-white/5">{row.test_title}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap font-bold leading-8 text-ink">{inline ?? (row.prompt || <span className="italic text-muted">{t("(savol matni yo'q)", "(no prompt)")}</span>)}</p>
          {Array.isArray(row.options) && row.options.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
            {row.options.map((option, index) => {
              const value = typeof option === "string" ? option : String(option);
              const isCorrect = row.correct_answer != null && (Array.isArray(row.correct_answer) ? row.correct_answer.map(String).includes(value) : String(row.correct_answer) === value);
              const wrongPick = wrong && !isCorrect && picked(value);
              return <span key={index} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${isCorrect ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : wrongPick ? "border-rose-400 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-line bg-white/70 text-ink dark:bg-white/5"}`}>{value}</span>;
            })}
          </div>}
          {!inline && !(Array.isArray(row.options) && row.options.length > 0) && <p className={`mt-1.5 flex items-start gap-1.5 whitespace-pre-wrap text-sm font-semibold ${wrong ? "text-rose-600 dark:text-rose-300" : right ? "text-emerald-600 dark:text-emerald-400" : "text-muted"}`}>
            {wrong ? <X className="mt-0.5 h-4 w-4 shrink-0" /> : right ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : null}
            <span>{answerText(row.student_answer)}</span>
          </p>}
          {wrong && row.correct_answer != null && !(Array.isArray(row.options) && row.options.length > 0) && <CorrectAnswerPill text={answerText(row.correct_answer)} label={t("To'g'ri javob", "Correct answer")} />}
        </article>;
      })}
    </div>}
  </div>;
}
