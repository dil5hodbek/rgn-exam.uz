"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, FilePenLine, MessageSquareText } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Annotation = { start: number; end: number; comment: string };
type Review = {
  id: string; attempt_id: string; test_title: string; task_title: string;
  instructions: string; prompt: string; answer: unknown; max_points: number;
  graded: boolean; points_awarded: number | null; feedback: string | null;
  annotations: Annotation[]; graded_at: string | null; submitted_at: string | null;
};

// The student's answer with the teacher's marked errors highlighted.
function AnnotatedAnswer({ text, annotations }: { text: string; annotations: Annotation[] }) {
  const sorted = [...annotations].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((mark, index) => {
    const start = Math.max(cursor, Math.min(mark.start, text.length));
    const end = Math.max(start, Math.min(mark.end, text.length));
    if (start > cursor) parts.push(<span key={`t-${index}`}>{text.slice(cursor, start)}</span>);
    parts.push(
      <mark key={`m-${index}`} className="rounded bg-red-500/15 px-0.5 text-red-600 underline decoration-red-400 decoration-wavy underline-offset-4 dark:text-red-400">
        {text.slice(start, end)}
        <sup className="ml-0.5 font-bold">{index + 1}</sup>
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <div className="whitespace-pre-wrap rounded-xl bg-surface p-4 text-sm leading-7 text-ink">{parts.length ? parts : (text || "No answer")}</div>;
}

export default function TeacherReviewPage() {
  const [rows, setRows] = useState<Review[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Review[]>("/me/teacher-reviews").then(setRows).catch((reason) => setError(String(reason)));
  }, []);

  const pending = (rows ?? []).filter((row) => !row.graded);
  const graded = (rows ?? []).filter((row) => row.graded);

  return <div className="mx-auto max-w-4xl p-4 sm:p-8">
    <p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Feedback</p>
    <h1 className="mt-2 text-3xl font-extrabold text-ink">Teacher Review</h1>
    <p className="mt-2 text-sm text-muted">Your writing and speaking answers: what the teacher marked, scored and commented.</p>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}

    {rows === null ? <div className="grid place-items-center py-24"><span className="h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-brand" /></div> : <>

    {pending.length > 0 && <section className="mt-8">
      <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-amber-600"><Clock3 className="h-4 w-4" /> Waiting for the teacher ({pending.length})</h2>
      <div className="mt-3 space-y-3">
        {pending.map((row) => <article key={row.id} className="rounded-2xl border border-amber-300/60 bg-canvas p-5">
          <p className="text-xs font-bold text-muted">{row.test_title}</p>
          <p className="mt-1 text-sm font-extrabold text-ink">{row.prompt}</p>
          <div className="mt-3"><AnnotatedAnswer text={String(row.answer ?? "")} annotations={[]} /></div>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-700"><Clock3 className="h-3.5 w-3.5" /> Not graded yet</p>
        </article>)}
      </div>
    </section>}

    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Graded ({graded.length})</h2>
      {graded.length === 0 && pending.length === 0 && <div className="mt-3 grid place-items-center rounded-2xl border border-dashed border-line p-12 text-center">
        <FilePenLine className="h-8 w-8 text-muted" />
        <p className="mt-3 text-sm font-semibold text-muted">Nothing here yet — solve a test with a writing exercise and it will appear here for teacher review.</p>
      </div>}
      <div className="mt-3 space-y-4">
        {graded.map((row) => {
          const text = String(row.answer ?? "");
          const marks = [...(row.annotations ?? [])].sort((a, b) => a.start - b.start);
          const percent = row.max_points ? Math.round(((row.points_awarded ?? 0) / row.max_points) * 100) : 0;
          return <article key={row.id} className="rounded-2xl border border-line bg-canvas p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-muted">{row.test_title}{row.graded_at ? ` · ${new Date(row.graded_at).toLocaleDateString()}` : ""}</p>
                <p className="mt-1 text-sm font-extrabold text-ink">{row.prompt}</p>
              </div>
              <span className={cn(
                "shrink-0 rounded-xl px-3.5 py-2 text-sm font-extrabold",
                percent >= 70 ? "bg-emerald-500/10 text-emerald-600" : percent >= 40 ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600",
              )}>{row.points_awarded ?? 0} / {row.max_points}</span>
            </div>
            <div className="mt-4"><AnnotatedAnswer text={text} annotations={marks} /></div>
            {marks.length > 0 && <ol className="mt-3 space-y-1.5">
              {marks.map((mark, index) => <li key={index} className="flex items-start gap-2 text-xs leading-5">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded bg-red-500/10 font-bold text-red-600">{index + 1}</span>
                <span className="min-w-0 text-ink"><b className="text-red-600">“{text.slice(mark.start, mark.end)}”</b>{mark.comment ? <> — {mark.comment}</> : null}</span>
              </li>)}
            </ol>}
            {row.feedback && <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-indigo-200 bg-indigo-500/5 p-3.5">
              <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <p className="text-sm leading-6 text-ink">{row.feedback}</p>
            </div>}
          </article>;
        })}
      </div>
    </section>
    </>}
  </div>;
}
