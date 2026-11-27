"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, FileQuestion, FileText, KeyRound, Lock, Play, Shuffle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExamPasswordDialog } from "@/components/exam/exam-password-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

type Variant = {
  id: string;
  title: string;
  variant_number: number;
  time_limit_minutes: number;
  passing_percentage: number;
  retake_allowed: boolean;
  locked: boolean;
};

export default function VariantsPage({ params }: { params: { level: string; examType: string } }) {
  const { t } = useLang();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [startingRandom, setStartingRandom] = useState(false);
  const [randomUnlocked, setRandomUnlocked] = useState(false);
  const [passwordFor, setPasswordFor] = useState<Variant | null>(null);
  const router = useRouter();
  const pretty = (value: string) => value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("-");
  const level = pretty(params.level);
  const examType = params.examType === "mid-course" ? "Mid-course" : params.examType === "end-course" ? "End-course" : pretty(params.examType);

  useEffect(() => {
    api<Variant[]>(`/levels/${params.level}/exam-types/${params.examType}/variants`)
      .then(setVariants)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t("Testlarni yuklab bo‘lmadi.", "Unable to load tests.")))
      .finally(() => setLoaded(true));
    api<{ exam_types: Record<string, boolean> }>(`/levels/${params.level}/access`)
      .then((access) => setRandomUnlocked(Boolean(access.exam_types[params.examType])))
      .catch(() => setRandomUnlocked(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.level, params.examType]);

  async function startRandomTest() {
    setError("");
    setStartingRandom(true);
    try {
      const attempt = await api<{ id: string; test_variant_id: string }>(
        `/levels/${params.level}/exam-types/${params.examType}/random-attempt`, { method: "POST" },
      );
      router.push(`/dashboard/${params.level}/${params.examType}/${attempt.test_variant_id}/attempt?attempt=${encodeURIComponent(attempt.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Testni boshlab bo'lmadi.", "Unable to start a test."));
      setStartingRandom(false);
    }
  }

  return <div className="dashboard-detail mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <Link href={`/dashboard/${params.level}`} className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {level}</Link>
    <div className="mt-7"><p className="text-xs font-bold uppercase tracking-[.08em] text-brand">{level}</p><h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink">{examType}</h1>{variants.some((variant) => variant.locked) && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-bold text-muted"><Lock className="h-3.5 w-3.5" /> {t("Yopiq testlar parol bilan ochiladi.", "Locked tests open with a password.")}</p>}</div>
    {variants.length > 0 && randomUnlocked && <div className="relative mt-7 overflow-hidden rounded-3xl bg-gradient-to-br from-[#e75225] to-[#ad3515] p-6 text-white shadow-lift sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
      <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-extrabold sm:text-3xl"><Shuffle className="h-6 w-6" /> {t("Aralash test", "Shuffled test")}</h2>
          <p className="mt-1.5 text-sm text-white/80">{t("Har safar yangi variant.", "A new mix every time.")}</p>
        </div>
        <Button onClick={startRandomTest} disabled={startingRandom} className="w-full shrink-0 !bg-white !text-[#ad3515] shadow-lg hover:!bg-white/90 sm:w-auto"><Play className="h-4 w-4" /> {startingRandom ? t("Tayyorlanmoqda…", "Preparing…") : t("Boshlash", "Start")}</Button>
      </div>
    </div>}
    {error && <p className="mt-6 rounded-xl bg-red-500/10 p-4 text-sm font-semibold text-red-600">{error}</p>}
    {!loaded && <div className="mt-9 grid gap-4 sm:grid-cols-2">{[1, 2].map((item) => <div key={item} className="h-52 animate-pulse rounded-3xl bg-canvas" />)}</div>}
    {loaded && !error && !variants.length && <div className="mt-9 rounded-3xl border border-dashed border-line bg-canvas p-10 text-center">
      <FileQuestion className="mx-auto h-10 w-10 text-muted" />
      <h2 className="mt-4 text-xl font-extrabold text-ink">{t("Hozircha test yo‘q", "No tests yet")}</h2>
      <p className="mt-1.5 text-sm text-muted">{t("Tez orada qo‘shiladi.", "Coming soon.")}</p>
      <Link href={`/dashboard/${params.level}`} className="mt-6 inline-flex"><Button variant="secondary"><ArrowLeft className="h-4 w-4" /> {level}</Button></Link>
    </div>}
    <div className="mt-9 grid gap-4 sm:grid-cols-2">{variants.map((variant) =>
      <article key={variant.id} className="variant-card relative overflow-hidden rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm shadow-orange-500/5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-orange-500/10 dark:border-orange-500/25 dark:from-orange-500/10 dark:via-transparent dark:to-transparent sm:p-6">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#f77926] via-[#ed5b22] to-[#c9430f]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-orange-400/15 blur-2xl" />
        <div className="relative flex items-center justify-between">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[#f77926] to-[#dc5b20] text-white shadow-md shadow-orange-500/30"><FileText className="h-5 w-5" /></span>
          {variant.locked && <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-1 text-xs font-bold text-orange-700 dark:text-orange-300"><Lock className="h-3.5 w-3.5" /> {t("Yopiq", "Locked")}</span>}
        </div>
        <h2 className="relative mt-4 text-lg font-extrabold leading-snug text-ink sm:text-xl">{variant.title}</h2>
        <div className="relative mt-5">{variant.locked
          ? <Button className="w-full" onClick={() => setPasswordFor(variant)}><KeyRound className="h-4 w-4" /> {t("Parol bilan kirish", "Enter with password")}</Button>
          : <Link href={`/dashboard/${params.level}/${params.examType}/${variant.id}/attempt`}><Button className="w-full"><Play className="h-4 w-4" /> {t("Boshlash", "Start")}</Button></Link>}</div>
      </article>
    )}</div>
    {passwordFor && <ExamPasswordDialog testVariantId={passwordFor.id} testTitle={passwordFor.title} onClose={() => setPasswordFor(null)} />}
  </div>;
}
