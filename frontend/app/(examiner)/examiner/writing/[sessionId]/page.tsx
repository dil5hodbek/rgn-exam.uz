"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronRight, ShieldOff, Sparkles } from "lucide-react";
import { Switch } from "@/components/examiner/exam-mode-toggle";
import { api } from "@/lib/api";
import { type ResultRow, type SessionResults, type StudentRow } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";
import { cn, formatDuration } from "@/lib/utils";

/** One exam's results: every student, their score, leaves and writing grades. */
export default function SessionResultsPage({ params }: { params: { sessionId: string } }) {
  const { lang, t } = useLang();
  const router = useRouter();
  const [data, setData] = useState<SessionResults | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<SessionResults>(`/examiner/sessions/${params.sessionId}/results`).then(setData)
    .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))), [params.sessionId]);
  useEffect(() => { load(); }, [load]);

  async function setExamMode(row: ResultRow, next: boolean) {
    setBusy(row.user_id);
    try {
      const student = await api<StudentRow>(`/examiner/students/${row.user_id}`, { method: "PATCH", body: JSON.stringify({ exam_mode: next }) });
      setData((current) => current && { ...current, students: current.students.map((item) => item.user_id === row.user_id ? { ...item, exam_mode: student.exam_mode !== false } : item) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  const open = (row: ResultRow) => router.push(`/examiner/writing/${params.sessionId}/${row.attempt_id}`);
  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <Link href="/examiner/writing" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {t("Writing va natijalar", "Writing & results")}</Link>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    {!data && !error && <div className="mt-6 h-64 animate-pulse rounded-3xl bg-canvas" />}
    {data && <>
      <h1 className="mt-4 text-3xl font-extrabold text-ink">{data.title || data.test_title}</h1>
      <p className="mt-1 text-sm text-muted">{data.level_name} · {data.exam_type_name} · V{data.variant_number} · {t(`${data.students.length} o'quvchi`, `${data.students.length} students`)}</p>
      <p className="mt-3 max-w-3xl text-xs leading-5 text-muted">{t(
        "O'quvchini bosing — har bir savolga nima yozgani, qaysilari to'g'ri va AI writing'ni qanday baholagani chiqadi. Writing bahosini teacher monitor panelida istalgan vaqt o'zgartira oladi.",
        "Click a student to see every answer, which were right and how the AI graded the writing. A teacher can change a writing grade at any time from the monitor panel.",
      )}</p>
      <div className="mt-6 overflow-x-auto rounded-3xl border border-line bg-canvas">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-surface text-[11px] font-bold uppercase tracking-wider text-muted"><tr>
            <th className="px-4 py-3">{t("O'quvchi", "Student")}</th>
            <th className="px-4 py-3">{t("Natija", "Score")}</th>
            <th className="px-4 py-3">{t("Javoblar", "Answers")}</th>
            <th className="px-4 py-3">Writing</th>
            <th className="px-4 py-3">{t("Chiqishlar", "Leaves")}</th>
            <th className="px-4 py-3">{t("Imtihon rejimi", "Exam mode")}</th>
            <th className="px-4 py-3" />
          </tr></thead>
          <tbody>{data.students.length ? data.students.map((row) => {
            const inProgress = row.status === "IN_PROGRESS";
            return <tr key={row.attempt_id} onClick={() => open(row)} className="cursor-pointer border-t border-line transition hover:bg-surface">
              <td className="px-4 py-3"><p className="font-extrabold text-ink">{row.first_name} {row.last_name}</p><p className="text-xs text-muted">{row.username ? `@${row.username}` : row.phone_number}</p>{row.removed && <span className="mt-1 inline-block rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-600">{t("chiqarilgan", "removed")}</span>}</td>
              <td className="px-4 py-3">{inProgress
                ? <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-700 dark:text-sky-300">{t("Yozmoqda", "Sitting")}</span>
                : <><p className={cn("text-lg font-extrabold", (row.percentage ?? 0) >= 60 ? "text-emerald-600" : "text-ink")}>{row.percentage === null ? "—" : `${Math.round(row.percentage)}%`}</p><p className="text-xs text-muted">{row.score} / {row.max_score} · {formatDuration(row.time_spent_seconds, lang)}</p></>}</td>
              <td className="px-4 py-3 text-xs font-bold"><span className="text-emerald-600">✓ {row.correct}</span> <span className="ml-2 text-red-500">✗ {row.incorrect}</span>{row.pending > 0 && <span className="ml-2 text-amber-600">? {row.pending}</span>}</td>
              <td className="px-4 py-3">{row.writing_total ? <div className="space-y-1">
                <p className="text-sm font-extrabold text-ink">{row.writing_points} / {row.writing_max}</p>
                <div className="flex flex-wrap gap-1 text-[10px] font-bold">
                  {row.writing_ai > 0 && <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300"><Sparkles className="h-3 w-3" />AI {row.writing_ai}</span>}
                  {row.writing_teacher > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">Teacher {row.writing_teacher}</span>}
                  {row.writing_awaiting > 0 && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">{t("kutilmoqda", "awaiting")} {row.writing_awaiting}</span>}
                </div>
              </div> : <span className="text-xs text-muted">—</span>}</td>
              <td className="px-4 py-3"><span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", row.violations ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-surface text-muted")}><AlertTriangle className="h-3 w-3" />{row.violations}/{row.max_violations}</span>{row.violations >= row.max_violations && <p className="mt-1 text-[10px] font-bold text-red-600">{t("avto yakunlangan", "auto-submitted")}</p>}</td>
              <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}><div className="flex items-center gap-2"><Switch checked={row.exam_mode} disabled={busy === row.user_id} onChange={(next) => setExamMode(row, next)} label={t("Imtihon rejimi", "Exam mode")} />{!row.exam_mode && <ShieldOff className="h-4 w-4 text-amber-500" />}</div></td>
              <td className="px-4 py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-muted" /></td>
            </tr>;
          }) : <tr><td colSpan={7} className="p-10 text-center text-sm text-muted">{t("Hali hech kim boshlamagan.", "Nobody has started yet.")}</td></tr>}</tbody>
        </table>
      </div>
    </>}
  </div>;
}
