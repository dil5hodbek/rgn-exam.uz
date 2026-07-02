"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookMarked, GraduationCap } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";

type ExamType = { id: string; name: string; slug: string };

export default function LevelPage({ params }: { params: { level: string } }) {
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [error, setError] = useState("");
  const levelName = params.level.split("-").map((item) => item[0].toUpperCase() + item.slice(1)).join("-");
  useEffect(() => {
    api<ExamType[]>(`/levels/${params.level}/exam-types`).then(setExamTypes)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load exam types."));
  }, [params.level]);
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
    <div className="mt-7"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Road Map level</p><h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink">{levelName}</h1><p className="mt-3 max-w-xl text-muted">Choose an exam type to see the variants available in your uploaded archive.</p></div>
    {error && <p className="mt-6 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-9 grid gap-5 md:grid-cols-2">{examTypes.map((exam, index) => { const Icon = index ? GraduationCap : BookMarked; return <Link key={exam.id} href={`/dashboard/${params.level}/${exam.slug}`} className="group rounded-3xl border border-line bg-canvas p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-lift"><div className="flex items-start justify-between"><span className={`grid h-14 w-14 place-items-center rounded-2xl ${index ? "bg-orange-500/10 text-orange-500" : "bg-indigo-500/10 text-indigo-500"}`}><Icon className="h-6 w-6" /></span><span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowRight className="h-4 w-4" /></span></div><h2 className="mt-8 text-2xl font-extrabold text-ink">{exam.name}</h2><p className="mt-3 leading-7 text-muted">Open the imported {exam.name.toLowerCase()} variants for {levelName}.</p><div className="mt-8 border-t border-line pt-5 text-sm font-bold text-brand">View available tests</div></Link>; })}</div>
  </div>;
}
