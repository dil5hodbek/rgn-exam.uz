"use client";

import { useEffect, useMemo, useState } from "react";
import { Edit3, Search } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

type TestRow = {
  id: string; title: string; variant_number: number; level: string; exam_type: string;
  status: string; sections_count: number; tasks_count: number; questions_count: number;
};

export default function TestLibrary() {
  const [rows, setRows] = useState<TestRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { api<TestRow[]>("/admin/tests").then(setRows).catch((reason) => setError(String(reason))); }, []);
  const filtered = useMemo(() => rows.filter((row) => `${row.title} ${row.level} ${row.exam_type}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);
  return <div className="mx-auto max-w-7xl p-4 sm:p-8"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">RAR content</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Test Library</h1><p className="mt-2 text-sm text-muted">All {rows.length || 26} imported Road Map variants. Open any test to edit tasks and answers.</p></div><div className="relative mt-7 max-w-md"><Search className="absolute left-4 top-3.5 h-4 w-4 text-muted" /><Input className="pl-11" placeholder="Search tests…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>{error && <p className="mt-4 text-red-600">{error}</p>}<div className="mt-5 overflow-hidden rounded-2xl border border-line bg-canvas">{filtered.map((row, index) => <div key={row.id} className={`flex items-center gap-4 p-4 sm:p-5 ${index ? "border-t border-line" : ""}`}><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500"><Edit3 className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-ink">{row.title}</p><p className="mt-1 text-xs text-muted">{row.level} · {row.exam_type} · {row.sections_count} sections · {row.tasks_count} tasks · {row.questions_count} questions</p></div><span className="hidden rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 sm:block">{row.status}</span><Link aria-label={`Edit ${row.title}`} href={`/admin/tests/${row.id}/edit`} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface hover:text-brand"><Edit3 className="h-4 w-4" /></Link></div>)}</div></div>;
}
