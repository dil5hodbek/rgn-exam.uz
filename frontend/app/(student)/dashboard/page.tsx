"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Award, Clock3, Target } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LevelCard } from "@/components/dashboard/level-card";
import { StatCard } from "@/components/dashboard/stat-card";
import { api } from "@/lib/api";
import { levelVisuals, type LevelCardData } from "@/lib/levels";
import { formatDuration } from "@/lib/utils";

type Me = { first_name: string };
type LevelApi = { id: string; name: string; slug: string; description: string; published_tests: number };
type Attempt = {
  id: string; test_variant_id: string; status: string; percentage: number;
  time_spent_seconds: number; title: string; level: string; level_slug: string;
  exam_type: string; exam_type_slug: string; started_at: string; submitted_at?: string;
};

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [catalog, setCatalog] = useState<LevelApi[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<Me>("/auth/me"), api<LevelApi[]>("/levels"), api<Attempt[]>("/me/attempts")])
      .then(([user, rows, history]) => { setMe(user); setCatalog(rows); setAttempts(history); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load dashboard."));
  }, []);

  const completed = attempts.filter((item) => item.status !== "IN_PROGRESS");
  // Dedupe to the best attempt per test so retakes/abandoned tries don't inflate
  // counts or skew the average — a student "solved" a test once, not per attempt.
  const bestByVariant = useMemo(() => {
    const map = new Map<string, Attempt>();
    for (const item of completed) {
      const prev = map.get(item.test_variant_id);
      if (!prev || item.percentage > prev.percentage) map.set(item.test_variant_id, item);
    }
    return map;
  }, [completed]);
  const solvedTests = useMemo(() => [...bestByVariant.values()], [bestByVariant]);
  const average = solvedTests.length ? Math.round(solvedTests.reduce((sum, item) => sum + item.percentage, 0) / solvedTests.length) : 0;
  const totalTime = attempts.reduce((sum, item) => sum + item.time_spent_seconds, 0);
  const inProgress = attempts.find((item) => item.status === "IN_PROGRESS");
  const completedByLevel = useMemo(() => solvedTests.reduce<Record<string, number>>((result, item) => {
    result[item.level_slug] = (result[item.level_slug] ?? 0) + 1;
    return result;
  }, {}), [solvedTests]);
  const displayedLevels: LevelCardData[] = catalog.map((row) => {
    // Never show more solved than exist (guards against stale/duplicate data).
    const done = Math.min(completedByLevel[row.slug] ?? 0, row.published_tests);
    const visual = levelVisuals[row.slug] ?? levelVisuals.beginner;
    return {
      ...row, ...visual, total: row.published_tests, completed: done,
      progress: row.published_tests ? Math.min(100, Math.round(done / row.published_tests * 100)) : 0,
    };
  });

  return <div className="mx-auto max-w-7xl px-4 py-7 sm:px-8 sm:py-9">
    <div><p className="text-sm font-bold text-brand">Welcome, {me?.first_name ?? "Student"}</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Your Road Map tests are ready</h1><p className="mt-2 text-sm text-muted">Choose your level and continue learning.</p></div>
    {error && <p className="mt-5 rounded-xl bg-red-500/10 p-4 text-sm font-semibold text-red-600">{error}</p>}
    <section className="mt-8 grid gap-4 sm:grid-cols-3">
      <StatCard label="Tests solved" value={String(solvedTests.length)} hint={`${catalog.reduce((sum, item) => sum + item.published_tests, 0)} tests available`} icon={Target} tone="bg-indigo-500/10 text-indigo-500" />
      <StatCard label="Average score" value={`${average}%`} hint={completed.length ? "Across submitted tests" : "Complete a test to begin"} icon={Award} tone="bg-emerald-500/10 text-emerald-500" />
      <StatCard label="Practice time" value={formatDuration(totalTime)} hint="Total submitted-test time" icon={Clock3} tone="bg-orange-500/10 text-orange-500" />
    </section>
    {inProgress && <section className="relative mt-5 overflow-hidden rounded-3xl bg-[#171a38] p-6 text-white shadow-soft sm:p-8"><div className="relative z-10 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-indigo-300">Continue where you left off</p><h2 className="mt-3 text-2xl font-extrabold">{inProgress.title}</h2><p className="mt-2 text-sm text-indigo-100/70">{inProgress.level} · {inProgress.exam_type}</p></div><Link href={`/dashboard/${inProgress.level_slug}/${inProgress.exam_type_slug}/${inProgress.test_variant_id}/attempt`}><Button className="bg-white text-[#171a38] shadow-none hover:bg-indigo-50">Continue Test <ArrowRight className="h-4 w-4" /></Button></Link></div><div className="absolute -right-8 -top-24 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" /></section>}
    <section className="mt-10"><div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Content</p><h2 className="mt-2 text-2xl font-extrabold text-ink">Choose your level</h2></div><span className="hidden text-sm text-muted sm:block">{catalog.reduce((sum, item) => sum + item.published_tests, 0)} tests</span></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{displayedLevels.map((level) => <LevelCard key={level.slug} level={level} />)}</div></section>
    <section className="mt-10"><div className="flex items-center justify-between"><h2 className="text-xl font-extrabold text-ink">Recent results</h2><Link href="/solved-tests" className="text-sm font-bold text-brand">View all</Link></div><div className="mt-4 overflow-hidden rounded-2xl border border-line bg-canvas">{completed.length ? completed.slice(0, 3).map((item, index) => <Link href={`/dashboard/${item.level_slug}/${item.exam_type_slug}/${item.test_variant_id}/result/${item.id}`} key={item.id} className={`flex items-center gap-4 p-4 transition hover:bg-surface sm:p-5 ${index ? "border-t border-line" : ""}`}><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${item.percentage >= 60 ? "bg-emerald-500/10 text-emerald-600" : "bg-orange-500/10 text-orange-600"}`}>{Math.round(item.percentage)}%</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{item.title}</p><p className="mt-1 text-xs text-muted">{item.level} · {item.exam_type}</p></div><span className="hidden text-xs font-medium text-muted sm:block">{new Date(item.submitted_at ?? item.started_at).toLocaleDateString()}</span><ArrowRight className="h-4 w-4 text-muted" /></Link>) : <p className="p-8 text-center text-sm text-muted">No submitted tests yet.</p>}</div></section>
  </div>;
}
