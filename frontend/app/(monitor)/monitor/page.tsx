"use client";
import { useEffect, useState } from "react";
import { ArrowRight, PenLine, Users } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";

type Submission = { id: string; status: string };
type Student = { id: string };

export default function MonitorOverview() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [studentCount, setStudentCount] = useState<number | null>(null);
  useEffect(() => {
    api<Submission[]>("/teacher/submissions").then((rows) => setPendingCount(rows.filter((row) => row.status !== "teacher_graded").length)).catch(() => setPendingCount(0));
    api<Student[]>("/teacher/students").then((rows) => setStudentCount(rows.length)).catch(() => setStudentCount(0));
  }, []);
  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Monitor</p>
    <h1 className="mt-2 text-3xl font-extrabold text-ink">Welcome back</h1>
    <p className="mt-2 text-sm text-muted">Review student writing and keep an eye on results.</p>
    <div className="mt-8 grid gap-5 sm:grid-cols-2">
      <Link href="/monitor/writing" className="group rounded-3xl border border-line bg-canvas p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-lift">
        <div className="flex items-start justify-between">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-fuchsia-500/10 text-fuchsia-500"><PenLine className="h-6 w-6" /></span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-fuchsia-500 group-hover:text-white"><ArrowRight className="h-4 w-4" /></span>
        </div>
        <h2 className="mt-8 text-2xl font-extrabold text-ink">Writing Review</h2>
        <p className="mt-3 leading-7 text-muted">{pendingCount === null ? "Loading…" : `${pendingCount} answer${pendingCount === 1 ? "" : "s"} awaiting your review.`}</p>
      </Link>
      <Link href="/monitor/students" className="group rounded-3xl border border-line bg-canvas p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-lift">
        <div className="flex items-start justify-between">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"><Users className="h-6 w-6" /></span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowRight className="h-4 w-4" /></span>
        </div>
        <h2 className="mt-8 text-2xl font-extrabold text-ink">Students</h2>
        <p className="mt-3 leading-7 text-muted">{studentCount === null ? "Loading…" : `${studentCount} registered student${studentCount === 1 ? "" : "s"}.`}</p>
      </Link>
    </div>
  </div>;
}
