"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, CircleHelp, Clock3, FilePenLine, Sparkles, UserRound, X } from "lucide-react";
import { ExamModeToggle } from "@/components/examiner/exam-mode-toggle";
import { api } from "@/lib/api";
import {
  formatAnswer, formatDateTime, WRITING_STATUS_STYLES, writingStatusLabel, type AttemptReview, type ReviewQuestion,
} from "@/lib/examiner";
import { useLang } from "@/lib/i18n";
import { cn, formatDuration } from "@/lib/utils";

type Filter = "all" | "writing" | "wrong" | "right";

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Student's essay with the grader's highlighted remarks (if any). */
function EssayText({ text, annotations }: { text: string; annotations: ReviewQuestion["annotations"] }) {
  const marks = [...annotations].filter((mark) => mark.end > mark.start).sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  marks.forEach((mark, index) => {
    const start = Math.max(cursor, Math.min(mark.start, text.length));
    const end = Math.max(start, Math.min(mark.end, text.length));
    if (start > cursor) parts.push(<span key={`t${index}`}>{text.slice(cursor, start)}</span>);
    if (end > start) parts.push(<mark key={`m${index}`} title={mark.comment} className="rounded bg-amber-300/40 px-0.5 text-ink">{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(<span key="rest">{text.slice(cursor)}</span>);
  return <p className="whitespace-pre-wrap text-[15px] leading-7 text-ink">{parts}</p>;
}

export default function AttemptReviewPage({ params }: { params: { sessionId: string; attemptId: string } }) {
  const { lang, t } = useLang();
  const [data, setData] = useState<AttemptReview | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    api<AttemptReview>(`/examiner/attempts/${params.attemptId}/review`).then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [params.attemptId]);

  const counts = useMemo(() => {
    const all = (data?.sections ?? []).flatMap((section) => section.tasks.flatMap((task) => task.questions.map((question) => ({ task, question }))));
    return {
      all: all.length,
      writing: all.filter(({ task }) => task.manual).length,
      wrong: all.filter(({ task, question }) => !task.manual && question.is_correct === false).length,
      right: all.filter(({ task, question }) => !task.manual && question.is_correct === true).length,
    };
  }, [data]);
  const keep = (manual: boolean, question: ReviewQuestion) => filter === "all"
    || (filter === "writing" && manual)
    || (filter === "wrong" && !manual && question.is_correct === false)
    || (filter === "right" && !manual && question.is_correct === true);
  const date = (value: string | null) => formatDateTime(value, lang);

  const filters: [Filter, string, number][] = [
    ["all", t("Hammasi", "All"), counts.all],
    ["writing", "Writing", counts.writing],
    ["wrong", t("Xato", "Wrong"), counts.wrong],
    ["right", t("To'g'ri", "Right"), counts.right],
  ];

  return <div className="mx-auto max-w-5xl p-4 sm:p-8">
    <Link href={`/examiner/writing/${params.sessionId}`} className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {t("Imtihon natijalari", "Exam results")}</Link>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    {!data && !error && <div className="mt-6 h-72 animate-pulse rounded-3xl bg-canvas" />}
    {data && <>
      <section className="mt-4 rounded-3xl bg-gradient-to-br from-[#123a3a] to-[#0f766e] p-6 text-white shadow-lift sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10"><UserRound className="h-6 w-6" /></span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold">{data.student.first_name} {data.student.last_name}</h1>
              <p className="truncate text-sm text-teal-100">{data.student.username ? `@${data.student.username} · ` : ""}{data.student.phone_number}</p>
              <p className="mt-1 truncate text-xs text-teal-100/80">{data.session_title} · {data.test_title}</p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-5xl font-extrabold">{data.status === "IN_PROGRESS" ? "…" : `${Math.round(data.percentage ?? 0)}%`}</p>
            <p className="text-sm text-teal-100">{data.status === "IN_PROGRESS" ? t("hali yozmoqda", "still sitting") : `${data.score} / ${data.max_score} · ${t("o'tish", "pass")} ${data.passing_percentage}%`}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2 text-xs font-bold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5"><Clock3 className="h-3.5 w-3.5" />{formatDuration(data.time_spent_seconds)}</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">{t("Topshirdi", "Submitted")}: {date(data.submitted_at)}</span>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5", data.violations ? "bg-red-500/30" : "bg-white/10")}><AlertTriangle className="h-3.5 w-3.5" />{t("Imtihon rejimidan chiqishlar", "Exam-mode leaves")}: {data.violations}/{data.max_violations}</span>
          {data.violations >= data.max_violations && <span className="rounded-full bg-red-500/40 px-3 py-1.5">{t("Avtomatik yakunlangan", "Auto-submitted")}</span>}
        </div>
      </section>

      <div className="mt-4"><ExamModeToggle compact studentId={data.student.id} enabled={data.student.exam_mode} maxViolations={data.max_violations}
        onChange={(enabled) => setData((current) => current && { ...current, student: { ...current.student, exam_mode: enabled } })} /></div>

      <div className="sticky top-16 z-20 -mx-4 mt-6 flex flex-wrap gap-2 bg-surface/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl">
        {filters.map(([value, label, count]) => <button key={value} type="button" onClick={() => setFilter(value)} className={cn("rounded-xl border px-3 py-1.5 text-xs font-bold transition", filter === value ? "border-teal-500 bg-teal-500/10 text-teal-700 dark:text-teal-300" : "border-line bg-canvas text-ink hover:border-teal-400")}>{label} <span className="ml-1 text-muted">{count}</span></button>)}
      </div>

      <div className="mt-4 space-y-6">{data.sections.map((section) => {
        const tasks = section.tasks.map((task) => ({ ...task, questions: task.questions.filter((question) => keep(task.manual, question)) })).filter((task) => task.questions.length);
        if (!tasks.length) return null;
        return <section key={section.title}>
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted">{section.title}</h2>
          <div className="mt-3 space-y-4">{tasks.map((task) => <article key={task.id} className="rounded-3xl border border-line bg-canvas p-5">
            <div className="flex items-start gap-3">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", task.manual ? "bg-sky-500/10 text-sky-600" : "bg-teal-500/10 text-teal-600")}>{task.manual ? <FilePenLine className="h-4 w-4" /> : <Check className="h-4 w-4" />}</span>
              <div className="min-w-0"><h3 className="font-extrabold text-ink">{task.title}</h3>{task.instructions && <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-muted">{task.instructions}</p>}</div>
            </div>
            <div className="mt-4 space-y-3">{task.questions.map((question, index) => task.manual
              ? <WritingCard key={question.id} question={question} date={date} />
              : <div key={question.id} className={cn("flex gap-3 rounded-2xl border p-3", question.is_correct === true ? "border-emerald-500/30 bg-emerald-500/5" : question.is_correct === false ? "border-red-500/30 bg-red-500/5" : "border-line bg-surface")}>
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white", question.is_correct === true ? "bg-emerald-500" : question.is_correct === false ? "bg-red-500" : "bg-slate-400")}>{question.is_correct === true ? <Check className="h-4 w-4" /> : question.is_correct === false ? <X className="h-4 w-4" /> : <CircleHelp className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink"><span className="mr-1 text-muted">{index + 1}.</span>{question.prompt || t("(savol matni yo'q)", "(no prompt)")}</p>
                  <p className="mt-1.5 text-xs text-muted">{t("O'quvchi javobi", "Student's answer")}: <b className={question.is_correct === false ? "text-red-600 dark:text-red-400" : "text-ink"}>{formatAnswer(question.student_answer)}</b></p>
                  {question.is_correct !== true && <p className="mt-0.5 text-xs text-muted">{t("To'g'ri javob", "Correct answer")}: <b className="text-emerald-700 dark:text-emerald-300">{formatAnswer(question.correct_answer)}</b></p>}
                </div>
                <span className="shrink-0 text-xs font-bold text-muted">{question.points_awarded ?? 0}/{question.max_points}</span>
              </div>)}</div>
          </article>)}</div>
        </section>;
      })}</div>
    </>}
  </div>;
}

function WritingCard({ question, date }: { question: ReviewQuestion; date: (value: string | null) => string }) {
  const { t } = useLang();
  const text = typeof question.student_answer === "string" ? question.student_answer : formatAnswer(question.student_answer);
  const empty = !text || text === "—";
  const status = question.status ?? "awaiting";
  return <div className="rounded-2xl border border-line bg-surface p-4">
    {question.prompt && <p className="text-sm font-semibold text-ink">{question.prompt}</p>}
    <div className="mt-3 rounded-xl border border-line bg-canvas p-4">
      {empty ? <p className="text-sm italic text-muted">{t("O'quvchi hech narsa yozmagan.", "The student wrote nothing.")}</p> : <EssayText text={text} annotations={question.annotations ?? []} />}
      {!empty && <p className="mt-3 text-[11px] font-bold text-muted">{t(`${wordCount(text)} ta so'z`, `${wordCount(text)} words`)}</p>}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", WRITING_STATUS_STYLES[status])}>{status === "ai_graded" && <Sparkles className="h-3 w-3" />}{writingStatusLabel(status, t)}{status === "teacher_graded" && question.graded_by_name ? ` · ${question.graded_by_name}` : ""}</span>
      <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-extrabold text-ink ring-1 ring-line">{question.points_awarded ?? "—"} / {question.max_points}</span>
      {question.graded_at && <span className="text-[11px] text-muted">{date(question.graded_at)}</span>}
    </div>
    {question.feedback && <div className={cn("mt-3 rounded-xl p-3 text-sm leading-6", status === "teacher_graded" ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-100" : "bg-sky-500/10 text-sky-900 dark:text-sky-100")}>
      <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider opacity-70">{status === "teacher_graded" ? t("Teacher izohi", "Teacher's feedback") : t("AI izohi", "AI feedback")}</p>
      <p className="whitespace-pre-wrap">{question.feedback}</p>
    </div>}
    {status === "awaiting" && !empty && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{t("AI baholay olmadi — teacher baholashini kuting.", "The AI could not grade this — waiting for a teacher.")}</p>}
  </div>;
}
