"use client";

import { useEffect, useState } from "react";
import { BookOpenCheck, FileCheck2, FileUp, GraduationCap, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Overview = { students: number; attempts: number; tests: number; pending_submissions: number };
type Audit = { id: string; action: string; entity_type: string; created_at: string };

export default function AdminOverview() {
  const [overview, setOverview] = useState<Overview>({ students: 0, attempts: 0, tests: 0, pending_submissions: 0 });
  const [audit, setAudit] = useState<Audit[]>([]);
  useEffect(() => {
    Promise.all([api<Overview>("/admin/overview"), api<Audit[]>("/admin/audit-log")])
      .then(([stats, logs]) => { setOverview(stats); setAudit(logs.slice(0, 6)); });
  }, []);
  const stats = [
    { label: "Registered students", value: overview.students, icon: Users, tone: "bg-indigo-500/10 text-indigo-500" },
    { label: "RAR tests", value: overview.tests, icon: BookOpenCheck, tone: "bg-emerald-500/10 text-emerald-500" },
    { label: "All attempts", value: overview.attempts, icon: FileCheck2, tone: "bg-sky-500/10 text-sky-500" },
    { label: "Awaiting review", value: overview.pending_submissions, icon: GraduationCap, tone: "bg-orange-500/10 text-orange-500" },
  ];
  return <div className="mx-auto max-w-7xl p-4 sm:p-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Live database</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Admin Overview</h1><p className="mt-2 text-sm text-muted">Only content imported from your Road Map archive is listed.</p></div><div className="flex gap-2"><Link href="/admin/import"><Button variant="secondary"><FileUp className="h-4 w-4" /> Import Package</Button></Link><Link href="/admin/tests"><Button>Manage Tests</Button></Link></div></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map((stat) => <div key={stat.label} className="rounded-2xl border border-line bg-canvas p-5"><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-muted">{stat.label}</p><p className="mt-2 text-3xl font-extrabold text-ink">{stat.value}</p></div><span className={`grid h-10 w-10 place-items-center rounded-xl ${stat.tone}`}><stat.icon className="h-5 w-5" /></span></div></div>)}</div>
    <section className="mt-6 rounded-3xl border border-line bg-canvas p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-extrabold text-ink">Recent activity</h2><p className="mt-1 text-xs text-muted">Real administrator actions.</p></div><Link href="/admin/audit-log" className="text-xs font-bold text-brand">View all</Link></div><div className="mt-5">{audit.length ? audit.map((item) => <div key={item.id} className="flex items-center gap-4 border-b border-line p-3 last:border-0"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /><div className="flex-1"><p className="text-sm font-bold text-ink">{item.action}</p><p className="text-xs text-muted">{item.entity_type}</p></div><span className="text-xs text-muted">{new Date(item.created_at).toLocaleString()}</span></div>) : <p className="py-8 text-center text-sm text-muted">No administrator changes yet.</p>}</div></section>
  </div>;
}
