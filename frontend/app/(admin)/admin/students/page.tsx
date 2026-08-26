"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Search, Shuffle, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Student = {
  id: string; first_name: string; last_name: string; phone_number: string;
  is_active: boolean; telegram_linked: boolean; created_at: string;
  total_attempts: number; average_percentage: number | null;
};
type StudentAttempt = {
  id: string; title: string; level: string; exam_type: string; is_mixed: boolean;
  status: string; percentage: number | null; passing_percentage: number; passed: boolean;
  started_at: string; submitted_at: string | null; time_spent_seconds: number | null;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function AttemptRow({ attempt }: { attempt: StudentAttempt }) {
  return <div className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
        {attempt.title}
        {attempt.is_mixed && <span title="Shuffled random test with mixed exercises" className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-bold text-indigo-500"><Shuffle className="h-3 w-3" /> Mixed</span>}
      </p>
      <p className="mt-0.5 text-xs text-muted">{attempt.level} · {attempt.exam_type} · {formatDateTime(attempt.submitted_at ?? attempt.started_at)}</p>
    </div>
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${attempt.passed ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
      {attempt.percentage !== null ? `${Math.round(attempt.percentage)}%` : "—"}
    </span>
    <span className="w-24 shrink-0 text-right text-xs font-semibold text-muted">
      {attempt.status === "PENDING_REVIEW" ? "Pending review" : attempt.passed ? "Passed" : "Not passed"}
    </span>
  </div>;
}

function StudentAttempts({ studentId }: { studentId: string }) {
  const [attempts, setAttempts] = useState<StudentAttempt[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ attempts: StudentAttempt[] }>(`/admin/students/${studentId}/attempts`)
      .then((data) => setAttempts(data.attempts))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load results."));
  }, [studentId]);
  if (error) return <p className="border-t border-line p-5 text-sm text-red-600">{error}</p>;
  if (!attempts) return <p className="border-t border-line p-5 text-sm text-muted">Loading results…</p>;
  if (!attempts.length) return <p className="border-t border-line p-5 text-sm text-muted">No completed tests yet.</p>;
  return <div className="border-t border-line bg-surface px-5">{attempts.map((attempt) => <AttemptRow key={attempt.id} attempt={attempt} />)}</div>;
}

export default function Students() {
  const [rows, setRows] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  async function load(value = "") { setRows(await api<Student[]>(`/admin/students?search=${encodeURIComponent(value)}`)); }
  useEffect(() => { load(); }, []);
  async function toggle(student: Student) {
    await api(`/admin/students/${student.id}/active?active=${!student.is_active}`, { method: "PATCH" });
    setRows(rows.map((item) => item.id === student.id ? { ...item, is_active: !item.is_active } : item));
  }
  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Registered users</p>
    <h1 className="mt-2 text-3xl font-extrabold text-ink">Students</h1>
    <div className="relative mt-7 max-w-md"><Search className="absolute left-4 top-3.5 h-4 w-4 text-muted" /><Input className="pl-11" placeholder="Search by name or phone…" value={search} onChange={(event) => { setSearch(event.target.value); load(event.target.value); }} /></div>
    <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-canvas">
      {rows.length ? rows.map((row, index) => {
        const open = expanded === row.id;
        return <div key={row.id} className={index ? "border-t border-line" : ""}>
          <button
            type="button"
            onClick={() => setExpanded(open ? null : row.id)}
            className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-surface"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500"><UserRound className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-ink">{row.first_name} {row.last_name}</p>
              <p className="text-xs text-muted">{row.phone_number} · Telegram {row.telegram_linked ? "linked" : "not linked"}</p>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <p className="text-sm font-extrabold text-ink">{row.total_attempts} test{row.total_attempts === 1 ? "" : "s"}</p>
              <p className="text-xs text-muted">{row.average_percentage !== null ? `avg ${row.average_percentage}%` : "no results yet"}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${row.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>{row.is_active ? "Active" : "Inactive"}</span>
            <Button size="sm" variant="secondary" onClick={(event) => { event.stopPropagation(); toggle(row); }}>{row.is_active ? "Deactivate" : "Activate"}</Button>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && <StudentAttempts studentId={row.id} />}
        </div>;
      }) : <p className="p-10 text-center text-sm text-muted">No students registered yet.</p>}
    </div>
  </div>;
}
