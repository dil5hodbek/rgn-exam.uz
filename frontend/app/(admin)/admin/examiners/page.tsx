"use client";
import { useEffect, useState } from "react";
import { Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

type Examiner = {
  id: string; first_name: string; last_name: string; phone_number: string; username: string | null;
  is_active: boolean; created_at: string; session_count: number;
};

function CreateExaminerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (examiner: Examiner) => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const examiner = await api<Examiner>("/admin/examiners", {
        method: "POST",
        body: JSON.stringify({
          first_name: firstName, last_name: lastName, phone_number: `+998${phone}`,
          username: username.trim() || null, password,
        }),
      });
      onCreated(examiner);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create this examiner.");
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
    <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-line bg-canvas p-6 shadow-lift" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h2 className="text-lg font-extrabold text-ink">Add examiner</h2><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:text-ink"><X className="h-4 w-4" /></button></div>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold text-ink">First Name<Input placeholder="Alex" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label>
        <label className="space-y-2 text-sm font-semibold text-ink">Last Name<Input placeholder="Morgan" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label>
      </div>
      <label className="mt-4 block space-y-2 text-sm font-semibold text-ink">
        Phone Number
        <div className="flex">
          <span className="grid h-12 shrink-0 whitespace-nowrap place-items-center rounded-l-xl border border-r-0 border-line bg-surface px-3 text-sm font-bold text-ink">+998</span>
          <Input className="min-w-0 flex-1 rounded-l-none" inputMode="numeric" placeholder="90 123 45 67" value={phone} onChange={(event) => setPhone(event.target.value)} required />
        </div>
      </label>
      <label className="mt-4 block space-y-2 text-sm font-semibold text-ink">Username <span className="font-normal text-muted">(optional, for sign-in)</span><Input autoCapitalize="none" placeholder="examiner.ali" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label className="mt-4 block space-y-2 text-sm font-semibold text-ink">Password<Input type="password" placeholder="At least 4 characters" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={4} /></label>
      {error && <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
      <Button type="submit" className="mt-5 w-full" disabled={saving}>{saving ? "Creating…" : "Create examiner"}</Button>
    </form>
  </div>;
}

export default function Examiners() {
  const [rows, setRows] = useState<Examiner[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api<Examiner[]>("/admin/examiners").then(setRows)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  async function toggle(examiner: Examiner) {
    try {
      await api(`/admin/examiners/${examiner.id}/active?active=${!examiner.is_active}`, { method: "PATCH" });
      setRows(rows.map((item) => item.id === examiner.id ? { ...item, is_active: !item.is_active } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-bold uppercase tracking-[.08em] text-brand">Exam proctoring</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Examiners</h1><p className="mt-2 max-w-2xl text-sm text-muted">Examiners run exam sessions: they pick a test, hand students the generated password, approve who may start, watch time and pause students. They also give students usernames and standing access to tests.</p></div>
      <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add examiner</Button>
    </div>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-7 overflow-hidden rounded-2xl border border-line bg-canvas">
      {rows.length ? rows.map((row, index) => <div key={row.id} className={`flex flex-wrap items-center gap-4 p-5 ${index ? "border-t border-line" : ""}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500/10 text-orange-500"><ShieldCheck className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-ink">{row.first_name} {row.last_name}</p><p className="text-xs text-muted">{row.phone_number}{row.username ? ` · @${row.username}` : ""} · {row.session_count} sessions</p></div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${row.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>{row.is_active ? "Active" : "Inactive"}</span>
        <Button size="sm" variant="secondary" onClick={() => toggle(row)}>{row.is_active ? "Deactivate" : "Activate"}</Button>
      </div>) : <p className="p-10 text-center text-sm text-muted">No examiners yet.</p>}
    </div>
    {creating && <CreateExaminerDialog onClose={() => setCreating(false)} onCreated={(examiner) => setRows((current) => [examiner, ...current])} />}
  </div>;
}
