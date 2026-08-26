"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Variant = {
  id: string;
  title: string;
  variant_number: number;
  time_limit_minutes: number;
  passing_percentage: number;
  retake_allowed: boolean;
};

export default function VariantsPage({ params }: { params: { level: string; examType: string } }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [error, setError] = useState("");
  const [startingRandom, setStartingRandom] = useState(false);
  const router = useRouter();
  const pretty = (value: string) => value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");

  useEffect(() => {
    api<Variant[]>(`/levels/${params.level}/exam-types/${params.examType}/variants`)
      .then(setVariants)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load tests."));
  }, [params.level, params.examType]);

  async function startRandomTest() {
    setStartingRandom(true);
    try {
      const attempt = await api<{ test_variant_id: string }>(
        `/levels/${params.level}/exam-types/${params.examType}/random-attempt`, { method: "POST" },
      );
      router.push(`/dashboard/${params.level}/${params.examType}/${attempt.test_variant_id}/attempt`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start a test.");
      setStartingRandom(false);
    }
  }

  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <Link href={`/dashboard/${params.level}`} className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Back to {pretty(params.level)}</Link>
    <div className="mt-7"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">{pretty(params.level)}</p><h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink">{pretty(params.examType)}</h1><p className="mt-3 text-muted">Choose a real test from the imported Road Map package. Answers save automatically.</p></div>
    {variants.length > 0 && <div className="relative mt-7 overflow-hidden rounded-3xl bg-gradient-to-br from-[#3a2a7a] via-[#5b3aa8] to-[#a445c9] p-6 text-white shadow-lift sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-fuchsia-400/20 blur-3xl" />
      <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur"><Sparkles className="h-3.5 w-3.5" /> Surprise me</span>
          <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">Shuffled Test</h2>
          <p className="mt-1.5 max-w-md text-sm text-white/80">A random variant with exercises reshuffled just for you, mixed with a taste of the other exam type.</p>
        </div>
        <Button onClick={startRandomTest} disabled={startingRandom} className="w-full shrink-0 !bg-white !text-[#3a2a7a] shadow-lg hover:!bg-white/90 sm:w-auto"><Sparkles className="h-4 w-4" /> {startingRandom ? "Shuffling…" : "Start Test"}</Button>
      </div>
    </div>}
    {error && <p className="mt-6 rounded-xl bg-red-500/10 p-4 text-sm font-semibold text-red-600">{error}</p>}
    {!variants.length && !error && <div className="mt-9 grid gap-4 sm:grid-cols-2">{[1, 2].map((item) => <div key={item} className="h-52 animate-pulse rounded-3xl bg-canvas" />)}</div>}
    <div className="mt-9 grid gap-4 sm:grid-cols-2">{variants.map((variant) =>
      <article key={variant.id} className="rounded-3xl border border-line bg-canvas p-6 shadow-sm">
        <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted">Variant {variant.variant_number}</span><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600">Available</span></div>
        <h2 className="mt-5 text-xl font-extrabold text-ink">{variant.title}</h2>
        <div className="mt-3 flex items-center gap-4 text-xs font-semibold text-muted"><span className="flex items-center gap-1"><Clock3 className="h-4 w-4" /> {variant.time_limit_minutes} minutes</span><span>Pass at {variant.passing_percentage}%</span></div>
        <div className="mt-6 border-t border-line pt-5"><Link href={`/dashboard/${params.level}/${params.examType}/${variant.id}/attempt`}><Button className="w-full"><Play className="h-4 w-4" /> Start Test</Button></Link></div>
      </article>
    )}</div>
  </div>;
}
