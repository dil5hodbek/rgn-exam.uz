"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, KeyRound, Play, Plus, X } from "lucide-react";
import { DEFAULT_EXAM_MINUTES, DurationPicker } from "@/components/examiner/duration-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDateTime, type ExaminerCatalog, type SessionSummary } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function CreateSessionDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const router = useRouter();
  const [catalog, setCatalog] = useState<ExaminerCatalog | null>(null);
  const [levelId, setLevelId] = useState("");
  const [examTypeId, setExamTypeId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(DEFAULT_EXAM_MINUTES);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<ExaminerCatalog>("/examiner/tests").then((data) => {
      setCatalog(data);
      const firstLevel = data.levels.find((level) => data.variants.some((variant) => variant.level_id === level.id));
      if (firstLevel) setLevelId(firstLevel.id);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  const variants = useMemo(() => (catalog?.variants ?? []).filter((variant) =>
    variant.level_id === levelId && (!examTypeId || variant.exam_type_id === examTypeId)), [catalog, levelId, examTypeId]);
  const typeName = (id: string) => catalog?.exam_types.find((row) => row.id === id)?.name ?? "";

  async function start() {
    if (!variantId) return;
    setSaving(true);
    setError("");
    try {
      const session = await api<{ id: string }>("/examiner/sessions", {
        method: "POST", body: JSON.stringify({ test_variant_id: variantId, title, time_limit_minutes: minutes }),
      });
      router.push(`/examiner/sessions/${session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-line bg-canvas shadow-lift" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-line p-5"><div><h2 className="text-lg font-extrabold text-ink">{t("Imtihon yaratish", "Create exam")}</h2><p className="text-xs text-muted">{t("Testni tanlang — parol o‘zi yaratiladi.", "Pick a test — the password is made for you.")}</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:text-ink"><X className="h-4 w-4" /></button></div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("Daraja", "Level")}</p>
          <div className="mt-2 flex flex-wrap gap-2">{catalog?.levels.map((level) => <button key={level.id} type="button" onClick={() => { setLevelId(level.id); setVariantId(""); }} className={cn("rounded-xl border px-3 py-2 text-sm font-bold transition", levelId === level.id ? "border-teal-500 bg-teal-500/10 text-teal-700 dark:text-teal-300" : "border-line text-ink hover:bg-surface")}>{level.name}</button>)}</div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("Imtihon turi", "Exam type")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setExamTypeId(""); setVariantId(""); }} className={cn("rounded-xl border px-3 py-2 text-sm font-bold transition", !examTypeId ? "border-teal-500 bg-teal-500/10 text-teal-700 dark:text-teal-300" : "border-line text-ink hover:bg-surface")}>{t("Hammasi", "All")}</button>
            {catalog?.exam_types.map((row) => <button key={row.id} type="button" onClick={() => { setExamTypeId(row.id); setVariantId(""); }} className={cn("rounded-xl border px-3 py-2 text-sm font-bold transition", examTypeId === row.id ? "border-teal-500 bg-teal-500/10 text-teal-700 dark:text-teal-300" : "border-line text-ink hover:bg-surface")}>{row.name}</button>)}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("Test", "Test")}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {variants.map((variant) => <button key={variant.id} type="button" onClick={() => setVariantId(variant.id)} className={cn("rounded-2xl border p-3 text-left transition", variantId === variant.id ? "border-teal-500 bg-teal-500/10 ring-2 ring-teal-500/30" : "border-line hover:bg-surface")}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{typeName(variant.exam_type_id)} · {t("Variant", "Variant")} {variant.variant_number}</p>
              <p className="mt-1 text-sm font-extrabold text-ink">{variant.title}</p>
              <p className="mt-1 text-xs text-muted">{variant.question_count} {t("savol", "questions")}</p>
            </button>)}
            {catalog && !variants.length && <p className="col-span-full rounded-xl bg-surface p-4 text-sm text-muted">{t("Bu yerda nashr qilingan test yo'q.", "No published tests here.")}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="exam-minutes" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted"><Clock3 className="h-3.5 w-3.5" /> {t("Imtihon vaqti", "Exam length")}</label>
          <div className="mt-2"><DurationPicker id="exam-minutes" value={minutes} onChange={setMinutes} /></div>
          <p className="mt-2 text-xs text-muted">{t("Imtihon paytida ham o‘zgartirsa bo‘ladi.", "You can change it during the exam too.")}</p>
        </div>
        <label className="block space-y-2 text-sm font-semibold text-ink">{t("Imtihon nomi (ixtiyoriy)", "Exam name (optional)")}<Input placeholder={t("Masalan: 3-guruh, Mid-course", "e.g. Group 3, Mid-course")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} /></label>
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
      </div>
      <div className="border-t border-line p-5"><Button className="w-full !bg-teal-600 hover:!bg-teal-700" size="lg" disabled={!variantId || saving} onClick={start}><Play className="h-4 w-4" /> {saving ? t("Yaratilmoqda…", "Creating…") : t(`Imtihon o'tkazish · ${minutes} daq`, `Run exam · ${minutes} min`)}</Button></div>
    </div>
  </div>;
}

export default function ExaminerSessions() {
  const { lang, t } = useLang();
  const [rows, setRows] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api<SessionSummary[]>("/examiner/sessions")
      .then((data) => { if (alive) { setRows(data); setError(""); } })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    load();
    const timer = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const active = (rows ?? []).filter((row) => row.status === "ACTIVE");
  const closed = (rows ?? []).filter((row) => row.status !== "ACTIVE");
  const when = (value: string) => formatDateTime(value, lang);

  const card = (row: SessionSummary) => <Link key={row.id} href={`/examiner/sessions/${row.id}`} className="group flex flex-col gap-4 rounded-3xl border border-line bg-canvas p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lift sm:flex-row sm:items-center">
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{row.level_name} · {row.exam_type_name} · V{row.variant_number}{row.examiner_name ? ` · ${row.examiner_name}` : ""}</p>
      <h3 className="mt-1 truncate text-lg font-extrabold text-ink">{row.title}</h3>
      <p className="mt-1 text-xs text-muted">{when(row.created_at)} · {row.time_limit_minutes} {t("daqiqa", "min")}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
        {row.pending > 0 && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-600">{row.pending} {t("kutmoqda", "waiting")}</span>}
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-600">{row.in_progress} {t("ishlamoqda", "working")}</span>
        <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-slate-600">{row.submitted} {t("topshirdi", "submitted")}</span>
      </div>
    </div>
    {row.status === "ACTIVE"
      ? <div className="shrink-0 rounded-2xl bg-teal-500/10 px-4 py-3 text-center"><p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300"><KeyRound className="h-3 w-3" /> {t("Parol", "Password")}</p><p className="mt-1 font-mono text-2xl font-extrabold tracking-[.2em] text-ink">{row.code}</p></div>
      : <span className="shrink-0 rounded-full bg-slate-500/10 px-3 py-1 text-xs font-bold text-slate-600">{t("Yakunlangan", "Closed")}</span>}
    <ArrowRight className="hidden h-5 w-5 shrink-0 text-muted transition group-hover:text-ink sm:block" />
  </Link>;

  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-bold uppercase tracking-[.08em] text-teal-600">{t("Imtihon nazorati", "Proctoring")}</p><h1 className="mt-2 text-3xl font-extrabold text-ink">{t("Imtihonlar", "Exam sessions")}</h1><p className="mt-2 max-w-2xl text-sm text-muted">{t("Imtihon yarating va jonli kuzating.", "Create exams and watch them live.")}</p></div>
      <Button className="!bg-teal-600 hover:!bg-teal-700" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {t("Imtihon yaratish", "Create exam")}</Button>
    </div>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    {rows === null && !error && <div className="mt-8 space-y-3">{[1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-3xl bg-canvas" />)}</div>}
    {rows && <>
      <h2 className="mt-8 text-sm font-extrabold uppercase tracking-wider text-muted">{t("Faol imtihonlar", "Active")}</h2>
      <div className="mt-3 space-y-3">{active.length ? active.map(card) : <p className="rounded-3xl border border-dashed border-line p-8 text-center text-sm text-muted">{t("Hozir faol imtihon yo'q. \"Imtihon yaratish\" tugmasini bosing.", "No active exams. Click \"Create exam\".")}</p>}</div>
      {closed.length > 0 && <><h2 className="mt-10 text-sm font-extrabold uppercase tracking-wider text-muted">{t("Yakunlanganlar", "Closed")}</h2><div className="mt-3 space-y-3">{closed.map(card)}</div></>}
    </>}
    {creating && <CreateSessionDialog onClose={() => setCreating(false)} />}
  </div>;
}
