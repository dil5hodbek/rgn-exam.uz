"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, FileText, Search, Sparkles, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDateTime, type SessionSummary } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Writing & results: every exam this examiner ran, newest first. */
export default function ExaminerWriting() {
  const { lang, t } = useLang();
  const [rows, setRows] = useState<SessionSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<SessionSummary[]>("/examiner/sessions").then(setRows)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (rows ?? []).filter((row) => (row.submitted + row.in_progress) > 0)
      .filter((row) => !term || `${row.title} ${row.test_title} ${row.level_name} ${row.exam_type_name}`.toLowerCase().includes(term));
  }, [rows, query]);
  const date = (value: string) => formatDateTime(value, lang);

  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <p className="text-xs font-extrabold uppercase tracking-wider text-teal-600">{t("Natijalar", "Results")}</p>
    <h1 className="mt-2 text-3xl font-extrabold text-ink">{t("Writing va natijalar", "Writing & results")}</h1>
    <p className="mt-2 max-w-2xl text-sm text-muted">{t(
      "Siz o'tkazgan imtihonlar. Imtihonni oching — o'quvchilar natijasi, imtihon rejimidan chiqishlari va AI writing'ni qanday baholagani chiqadi.",
      "The exams you ran. Open one to see each student's result, how often they left exam mode and how the AI graded their writing.",
    )}</p>
    <div className="relative mt-6 max-w-md"><Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted" /><Input className="pl-10" placeholder={t("Imtihon yoki test nomi", "Exam or test name")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    {!rows && !error && <div className="mt-6 grid gap-3">{[0, 1, 2].map((key) => <div key={key} className="h-24 animate-pulse rounded-3xl bg-canvas" />)}</div>}
    {rows && !shown.length && <div className="mt-6 rounded-3xl border border-dashed border-line bg-canvas p-10 text-center">
      <FileText className="mx-auto h-10 w-10 text-muted" />
      <p className="mt-3 font-extrabold text-ink">{t("Hali natija yo'q", "No results yet")}</p>
      <p className="mt-1 text-sm text-muted">{t("O'quvchilar siz o'tkazgan imtihonni boshlagach shu yerda chiqadi.", "Exams appear here once students start one you ran.")}</p>
    </div>}
    <div className="mt-6 grid gap-3">{shown.map((row) => <Link key={row.id} href={`/examiner/writing/${row.id}`} className="group flex flex-col gap-4 rounded-3xl border border-line bg-canvas p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lift sm:flex-row sm:items-center">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal-500/10 text-teal-600"><FileText className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-extrabold text-ink">{row.title || row.test_title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{row.level_name} · {row.exam_type_name} · V{row.variant_number}{row.examiner_name ? ` · ${row.examiner_name}` : ""}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-muted"><CalendarDays className="h-3 w-3" />{date(row.created_at)}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-muted"><Users className="h-3 w-3" />{t(`${row.submitted} topshirdi`, `${row.submitted} submitted`)}{row.in_progress ? t(` · ${row.in_progress} yozmoqda`, ` · ${row.in_progress} sitting`) : ""}</span>
          {(row.writing_total ?? 0) > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-sky-700 dark:text-sky-300"><Sparkles className="h-3 w-3" />{t(`${row.writing_total} ta writing`, `${row.writing_total} writings`)}</span>}
          {(row.writing_awaiting ?? 0) > 0 && <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-300">{t(`${row.writing_awaiting} ta baho kutilmoqda`, `${row.writing_awaiting} awaiting a grade`)}</span>}
        </div>
      </div>
      <span className={cn("inline-flex items-center gap-1.5 self-start rounded-xl px-3 py-2 text-xs font-bold sm:self-center", row.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-surface text-muted")}>{row.status === "ACTIVE" ? t("Davom etmoqda", "Running") : t("Yakunlangan", "Closed")}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
    </Link>)}</div>
  </div>;
}
