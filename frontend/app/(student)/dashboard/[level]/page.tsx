"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookMarked, Check, ClipboardCheck, GraduationCap, Hourglass, Layers, Lock, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { variantName, variantTag } from "@/lib/exam-types";
import { cn, formatDay } from "@/lib/utils";

type ExamType = { id: string; name: string; slug: string };
type Variant = { id: string; title: string; variant_number: number; locked: boolean };
type Attempt = {
  id: string; test_variant_id: string; status: string; percentage: number; title: string;
  level_slug: string; exam_type: string; exam_type_slug: string; started_at: string; submitted_at?: string;
};

function ProgressRing({ value }: { value: number }) {
  const radius = 22;
  const length = 2 * Math.PI * radius;
  return <span className="relative grid h-14 w-14 shrink-0 place-items-center" role="img" aria-label={`${value}%`}>
    <svg viewBox="0 0 52 52" className="absolute inset-0 h-full w-full -rotate-90">
      <circle cx="26" cy="26" r={radius} fill="none" strokeWidth="5" stroke="rgba(127,127,127,.18)" />
      <circle cx="26" cy="26" r={radius} fill="none" strokeWidth="5" strokeLinecap="round" stroke="#f26522"
        strokeDasharray={length} strokeDashoffset={length * (1 - value / 100)} style={{ transition: "stroke-dashoffset .6s ease" }} />
    </svg>
    <span className="text-xs font-extrabold tabular-nums text-ink">{value}%</span>
  </span>;
}

export default function LevelPage({ params }: { params: { level: string } }) {
  const { lang, t } = useLang();
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [variants, setVariants] = useState<Record<string, Variant[]>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState("");
  const [startingLevelTest, setStartingLevelTest] = useState(false);
  const [levelTestUnlocked, setLevelTestUnlocked] = useState<boolean | null>(null);
  const router = useRouter();
  const levelName = params.level.split("-").map((item) => item[0].toUpperCase() + item.slice(1)).join("-");
  useEffect(() => {
    api<ExamType[]>(`/levels/${params.level}/exam-types`).then((types) => {
      setExamTypes(types);
      // Each card shows its own variants, so fetch them alongside.
      types.forEach((type) => api<Variant[]>(`/levels/${params.level}/exam-types/${type.slug}/variants`)
        .then((rows) => setVariants((current) => ({ ...current, [type.slug]: rows })))
        .catch(() => setVariants((current) => ({ ...current, [type.slug]: [] }))));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : t("Imtihon turlarini yuklab bo'lmadi.", "Unable to load exam types.")));
    api<Attempt[]>("/me/attempts").then(setAttempts).catch(() => setAttempts([]));
    api<{ level_test: boolean }>(`/levels/${params.level}/access`)
      .then((access) => setLevelTestUnlocked(access.level_test))
      .catch(() => setLevelTestUnlocked(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.level]);

  // Best finished score per test in this level.
  const finished = useMemo(() => attempts.filter((row) => row.level_slug === params.level && row.status !== "IN_PROGRESS"), [attempts, params.level]);
  const best = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of finished) map.set(row.test_variant_id, Math.max(map.get(row.test_variant_id) ?? 0, row.percentage));
    return map;
  }, [finished]);

  async function startLevelTest() {
    setError("");
    setStartingLevelTest(true);
    try {
      const attempt = await api<{ id: string; test_variant_id: string; exam_type_slug: string }>(`/levels/${params.level}/level-test-attempt`, { method: "POST" });
      router.push(`/dashboard/${params.level}/${attempt.exam_type_slug}/${attempt.test_variant_id}/attempt?attempt=${encodeURIComponent(attempt.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Daraja testini boshlab bo'lmadi.", "Unable to start the level test."));
      setStartingLevelTest(false);
    }
  }

  return <div className="dashboard-detail mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {t("Bosh sahifa", "Dashboard")}</Link>
    <div className="mt-7"><p className="text-xs font-bold uppercase tracking-[.08em] text-brand">{t("Daraja", "Level")}</p><h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink">{levelName}</h1></div>
    <div className="relative mt-7 overflow-hidden rounded-3xl bg-gradient-to-br from-[#d94a1b] via-[#ec5b20] to-[#f47b35] p-6 text-white shadow-lift sm:p-8">
      <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-orange-200/20 blur-3xl" />
      <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-extrabold sm:text-3xl"><Layers className="h-6 w-6" /> {t("Daraja testi", "Level test")}</h2>
          <p className="mt-1.5 text-sm text-white/90">{t("Mid-course + End-course, bitta testda.", "Mid-course + End-course in one test.")}</p>
        </div>
        {levelTestUnlocked === false
          ? <span className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-bold sm:w-auto"><Lock className="h-4 w-4" /> {t("Yopiq", "Locked")}</span>
          : <Button onClick={startLevelTest} disabled={startingLevelTest || levelTestUnlocked === null} className="w-full shrink-0 !bg-white !text-[#bf3e16] shadow-lg hover:!bg-white/90 sm:w-auto"><Layers className="h-4 w-4" /> {startingLevelTest ? t("Tayyorlanmoqda…", "Preparing…") : t("Boshlash", "Start")}</Button>}
      </div>
    </div>
    {error && <p className="mt-6 text-sm font-semibold text-red-600">{error}</p>}

    <div className={cn("mt-9 grid gap-5 md:grid-cols-2", examTypes.length > 2 && "2xl:grid-cols-3")}>{examTypes.map((exam) => {
      const Icon = exam.slug === "unit-test" ? ClipboardCheck : exam.slug === "end-course" ? GraduationCap : BookMarked;
      const rows = variants[exam.slug];
      const done = rows?.filter((row) => best.has(row.id)).length ?? 0;
      const top = rows?.reduce<number | null>((max, row) => best.has(row.id) ? Math.max(max ?? 0, best.get(row.id) ?? 0) : max, null) ?? null;
      const progress = rows?.length ? Math.round(done / rows.length * 100) : 0;
      const title = <div className="flex items-center gap-3">
        <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", rows?.length === 0 ? "border border-line bg-surface text-muted" : "bg-orange-500/10 text-orange-500")}><Icon className="h-6 w-6" /></span>
        <h2 className="min-w-0 flex-1 truncate text-2xl font-extrabold text-ink">{exam.name.replace(/ Exam$/, "")}</h2>
        {rows?.length !== 0 && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowRight className="h-4 w-4" /></span>}
      </div>;
      // No published tests yet: a quiet "coming soon" card, nothing to open.
      if (rows?.length === 0) return <div key={exam.id} className="flex flex-col rounded-3xl border border-dashed border-line bg-canvas/60 p-5 sm:p-6">
        {title}
        <div className="mt-5 flex flex-1 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-4">
          <Hourglass className="h-5 w-5 shrink-0 text-muted" />
          <div><p className="text-sm font-extrabold text-ink">{t("Hozircha test yo‘q", "No tests yet")}</p><p className="text-xs text-muted">{t("Tez orada qo‘shiladi.", "Coming soon.")}</p></div>
        </div>
      </div>;
      const short = (name: string) => name.includes(" — ") ? name.split(" — ").pop() ?? name : name;
      return <Link prefetch={true} key={exam.id} href={`/dashboard/${params.level}/${exam.slug}`} className="group flex flex-col overflow-hidden rounded-3xl border border-line bg-canvas shadow-sm transition hover:-translate-y-1 hover:shadow-lift">
        <div className="flex items-center gap-4 p-5 sm:p-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-500/10 text-orange-500"><Icon className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-extrabold leading-tight text-ink">{exam.name.replace(/ Exam$/, "")}</h2>
            <p className="mt-1 text-sm leading-snug text-muted">{rows === undefined ? " " : <>
              {t(`${done}/${rows.length} yechildi`, `${done}/${rows.length} solved`)}
              {top !== null && <> · {t("eng yaxshi", "best")} <span className={cn("font-bold", top >= 60 ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400")}>{Math.round(top)}%</span></>}
            </>}</p>
          </div>
          <ProgressRing value={progress} />
        </div>
        {rows === undefined
          ? <div className="mx-5 mb-5 h-24 animate-pulse rounded-2xl bg-surface sm:mx-6 sm:mb-6" />
          : <ul className="border-t border-line">{rows.slice(0, 4).map((row) => {
            const score = best.get(row.id);
            return <li key={row.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0 sm:px-6">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold tabular-nums",
                score !== undefined ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-surface text-muted")}>{variantTag(exam.slug, row.variant_number)}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{short(row.title)}</span>
              {score !== undefined
                ? <span className="inline-flex shrink-0 items-center gap-1 text-sm font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> {Math.round(score)}%</span>
                : row.locked
                  ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-muted"><Lock className="h-3.5 w-3.5" /> {t("Yopiq", "Locked")}</span>
                  : <span className="shrink-0 text-xs font-bold text-orange-600 dark:text-orange-400">{t("Ochiq", "Open")}</span>}
            </li>;
          })}
            {rows.length > 4 && <li className="px-5 py-3 text-xs font-bold text-muted sm:px-6">{t(`Yana ${rows.length - 4} ta`, `${rows.length - 4} more`)}</li>}
          </ul>}
        <div className="mt-auto flex items-center justify-between border-t border-line bg-surface/50 px-5 py-3 text-sm font-bold text-brand sm:px-6">
          {t("Variantlarni ko‘rish", "View variants")}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </div>
      </Link>;
    })}</div>

    <section className="mt-10">
      <h2 className="text-xl font-extrabold text-ink">{t("Natijalaringiz", "Your results")}</h2>
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-canvas">{finished.length
        ? finished.slice(0, 4).map((item, index) => <Link key={item.id} href={`/dashboard/${params.level}/${item.exam_type_slug}/${item.test_variant_id}/result/${item.id}`} className={cn("flex items-center gap-4 p-4 transition hover:bg-surface", index > 0 && "border-t border-line")}>
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xs font-extrabold", item.percentage >= 60 ? "bg-emerald-500/10 text-emerald-600" : "bg-orange-500/10 text-orange-600")}>{Math.round(item.percentage)}%</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-ink">{item.title}</span><span className="mt-0.5 block text-xs text-muted">{item.exam_type} · {formatDay(item.submitted_at ?? item.started_at, lang)}</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
        </Link>)
        : <div className="flex items-center gap-4 p-5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface text-muted"><Trophy className="h-5 w-5" /></span><p className="text-sm text-muted">{t("Hali natija yo‘q. Birinchi testni yeching.", "No results yet. Take your first test.")}</p></div>}
      </div>
    </section>
  </div>;
}
