"use client";

import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/use-confirm";
import { CreateTestDialog } from "@/components/admin/create-test-dialog";
import { api } from "@/lib/api";

type TestRow = {
  id: string; title: string; variant_number: number; level: string; exam_type: string;
  level_slug: string; exam_type_slug: string;
  status: string; sections_count: number; tasks_count: number; questions_count: number;
};

export default function TestLibrary() {
  const [rows, setRows] = useState<TestRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { confirm, dialog } = useConfirm();
  useEffect(() => { api<TestRow[]>("/admin/tests").then(setRows).catch((reason) => setError(String(reason))); }, []);
  const filtered = useMemo(() => rows.filter((row) => `${row.title} ${row.level} ${row.exam_type}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);

  // Delete ONE variant (only possible while no student has attempted it).
  function deleteOne(row: TestRow) {
    confirm({
      title: `Delete "${row.title}"?`,
      description: `This removes its ${row.tasks_count} exercise(s) and cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: () => doDeleteOne(row),
    });
  }

  async function doDeleteOne(row: TestRow) {
    setError("");
    try {
      await api(`/admin/tests/${row.id}`, { method: "DELETE" });
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete this test.");
    }
  }

  async function resetAll() {
    const password = window.prompt(`Delete ALL ${rows.length} tests and every student attempt? This cannot be undone.\n\nEnter your admin password to confirm:`);
    if (!password) return;
    setResetting(true);
    setError("");
    try {
      const result = await api<{ tests_removed: number; attempts_removed: number }>("/admin/content", {
        method: "DELETE", body: JSON.stringify({ password }),
      });
      setRows([]);
      window.alert(`Removed ${result.tests_removed} tests and ${result.attempts_removed} attempts.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset content.");
    } finally {
      setResetting(false);
    }
  }
  return <div className="mx-auto max-w-7xl p-4 sm:p-8">
    {dialog}
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Content</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Test Library</h1><p className="mt-2 text-sm text-muted">{rows.length} test variant{rows.length === 1 ? "" : "s"}. Open any test to edit exercises and answers, or create a new one.</p></div>
      <div className="flex shrink-0 gap-2">
        {rows.length > 0 && <Button variant="danger" onClick={resetAll} disabled={resetting}><Trash2 className="h-4 w-4" /> Reset all content</Button>}
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create test</Button>
      </div>
    </div>
    <div className="relative mt-7 max-w-md"><Search className="absolute left-4 top-3.5 h-4 w-4 text-muted" /><Input className="pl-11" placeholder="Search tests…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {error && <p className="mt-4 text-red-600">{error}</p>}
    <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-canvas">{filtered.map((row, index) => <div key={row.id} className={`flex items-center gap-4 p-4 sm:p-5 ${index ? "border-t border-line" : ""}`}><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500"><Edit3 className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-ink">{row.title}</p><p className="mt-1 text-xs text-muted">{row.level} · {row.exam_type} · {row.sections_count} sections · {row.tasks_count} tasks · {row.questions_count} questions</p></div><span className="hidden rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 sm:block">{row.status}</span><Link aria-label={`Edit ${row.title}`} href={`/admin/tests/${row.id}/edit`} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface hover:text-brand"><Edit3 className="h-4 w-4" /></Link><button aria-label={`Delete ${row.title}`} title="Delete this variant" onClick={() => deleteOne(row)} className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-red-500/10 hover:text-red-500"><Trash2 className="h-4 w-4" /></button></div>)}</div>
    {creating && <CreateTestDialog existing={rows.map((row) => ({ level_slug: row.level_slug, exam_type_slug: row.exam_type_slug, variant_number: row.variant_number }))} onClose={() => setCreating(false)} />}
  </div>;
}
