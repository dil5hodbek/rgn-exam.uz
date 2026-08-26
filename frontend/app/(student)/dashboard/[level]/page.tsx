"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookMarked, GraduationCap, Layers } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type ExamType = { id: string; name: string; slug: string };

export default function LevelPage({ params }: { params: { level: string } }) {
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [error, setError] = useState("");
  const [startingLevelTest, setStartingLevelTest] = useState(false);
  const router = useRouter();
  const levelName = params.level.split("-").map((item) => item[0].toUpperCase() + item.slice(1)).join("-");
  useEffect(() => {
    api<ExamType[]>(`/levels/${params.level}/exam-types`).then(setExamTypes)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load exam types."));
  }, [params.level]);

  async function startLevelTest() {
    setStartingLevelTest(true);
    try {
      const attempt = await api<{ test_variant_id: string; exam_type_slug: string }>(`/levels/${params.level}/level-test-attempt`, { method: "POST" });
      router.push(`/dashboard/${params.level}/${attempt.exam_type_slug}/${attempt.test_variant_id}/attempt`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start the level test.");
      setStartingLevelTest(false);
    }
  }

  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
    <div className="mt-7"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Road Map level</p><h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink">{levelName}</h1><p className="mt-3 max-w-xl text-muted">Choose an exam type to see the variants available in your uploaded archive.</p></div>
    <div className="relative mt-7 overflow-hidden rounded-3xl bg-gradient-to-br from-[#7a2a5e] via-[#b8386f] to-[#f2703f] p-6 text-white shadow-lift sm:p-8">
      <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-amber-300/20 blur-3xl" />
      <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur"><Layers className="h-3.5 w-3.5" /> Whole level</span>
          <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">Level Test</h2>
          <p className="mt-1.5 max-w-md text-sm text-white/80">One test drawing from both Mid-course and End-course exercises for {levelName} — a full sweep of the level.</p>
        </div>
        <Button onClick={startLevelTest} disabled={startingLevelTest} className="w-full shrink-0 !bg-white !text-[#7a2a5e] shadow-lg hover:!bg-white/90 sm:w-auto"><Layers className="h-4 w-4" /> {startingLevelTest ? "Starting…" : "Start Level Test"}</Button>
      </div>
    </div>
    {error && <p className="mt-6 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-9 grid gap-5 md:grid-cols-2">{examTypes.map((exam, index) => { const Icon = index ? GraduationCap : BookMarked; return <Link key={exam.id} href={`/dashboard/${params.level}/${exam.slug}`} className="group rounded-3xl border border-line bg-canvas p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-lift"><div className="flex items-start justify-between"><span className={`grid h-14 w-14 place-items-center rounded-2xl ${index ? "bg-orange-500/10 text-orange-500" : "bg-indigo-500/10 text-indigo-500"}`}><Icon className="h-6 w-6" /></span><span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowRight className="h-4 w-4" /></span></div><h2 className="mt-8 text-2xl font-extrabold text-ink">{exam.name}</h2><p className="mt-3 leading-7 text-muted">Open the imported {exam.name.toLowerCase()} variants for {levelName}.</p><div className="mt-8 border-t border-line pt-5 text-sm font-bold text-brand">View available tests</div></Link>; })}</div>
  </div>;
}
