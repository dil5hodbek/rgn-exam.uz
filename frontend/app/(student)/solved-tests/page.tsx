"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

type Attempt = {
  id: string; test_variant_id: string; status: string; percentage: number;
  title: string; level: string; level_slug: string; exam_type: string; exam_type_slug: string;
  submitted_at?: string; started_at: string; time_spent_seconds: number;
};

export default function SolvedTests() {
  const [rows, setRows] = useState<Attempt[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<Attempt[]>("/me/attempts").then((items) => setRows(items.filter((item) => item.status !== "IN_PROGRESS")))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load results."));
  }, []);
  const filtered = useMemo(() => rows.filter((item) => `${item.title} ${item.level} ${item.exam_type}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Your record</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Solved Tests</h1><p className="mt-2 text-sm text-muted">Every submitted Road Map test appears here.</p></div>
    <div className="relative mt-7 max-w-md"><Search className="absolute left-4 top-3.5 h-4 w-4 text-muted" /><Input className="pl-11" placeholder="Search tests…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {error && <p className="mt-5 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-canvas">{filtered.length ? filtered.map((item, index) => <Link href={`/dashboard/${item.level_slug}/${item.exam_type_slug}/${item.test_variant_id}/result/${item.id}`} key={item.id} className={`group flex items-center gap-4 p-4 transition hover:bg-surface sm:p-5 ${index ? "border-t border-line" : ""}`}><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${item.percentage >= 60 ? "bg-emerald-500/10 text-emerald-600" : "bg-orange-500/10 text-orange-600"}`}>{Math.round(item.percentage)}%</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-ink">{item.title}</p><p className="mt-1 text-xs text-muted">{item.level} · {item.exam_type}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-bold text-ink">{new Date(item.submitted_at ?? item.started_at).toLocaleDateString()}</p><p className="mt-1 text-xs text-muted">{formatDuration(item.time_spent_seconds)}</p></div><span className={`hidden rounded-full px-2.5 py-1 text-xs font-bold md:block ${item.percentage >= 60 ? "bg-emerald-500/10 text-emerald-600" : "bg-orange-500/10 text-orange-600"}`}>{item.percentage >= 60 ? "Passed" : "Review"}</span><ChevronRight className="h-4 w-4 text-muted transition group-hover:translate-x-1" /></Link>) : <p className="p-10 text-center text-sm text-muted">No solved tests yet.</p>}</div>
  </div>;
}
