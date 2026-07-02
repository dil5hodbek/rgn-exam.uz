"use client";
import { useEffect, useState } from "react";
import { Search, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Student = { id: string; first_name: string; last_name: string; phone_number: string; is_active: boolean; telegram_linked: boolean; created_at: string };
export default function Students() {
  const [rows, setRows] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  async function load(value = "") { setRows(await api<Student[]>(`/admin/students?search=${encodeURIComponent(value)}`)); }
  useEffect(() => { load(); }, []);
  async function toggle(student: Student) {
    await api(`/admin/students/${student.id}/active?active=${!student.is_active}`, { method: "PATCH" });
    setRows(rows.map((item) => item.id === student.id ? { ...item, is_active: !item.is_active } : item));
  }
  return <div className="mx-auto max-w-6xl p-4 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Registered users</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Students</h1><div className="relative mt-7 max-w-md"><Search className="absolute left-4 top-3.5 h-4 w-4 text-muted" /><Input className="pl-11" placeholder="Search by name or phone…" value={search} onChange={(event) => { setSearch(event.target.value); load(event.target.value); }} /></div><div className="mt-5 overflow-hidden rounded-2xl border border-line bg-canvas">{rows.length ? rows.map((row, index) => <div key={row.id} className={`flex items-center gap-4 p-5 ${index ? "border-t border-line" : ""}`}><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500"><UserRound className="h-4 w-4" /></span><div className="flex-1"><p className="text-sm font-extrabold text-ink">{row.first_name} {row.last_name}</p><p className="text-xs text-muted">{row.phone_number} · Telegram {row.telegram_linked ? "linked" : "not linked"}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>{row.is_active ? "Active" : "Inactive"}</span><Button size="sm" variant="secondary" onClick={() => toggle(row)}>{row.is_active ? "Deactivate" : "Activate"}</Button></div>) : <p className="p-10 text-center text-sm text-muted">No students registered yet.</p>}</div></div>;
}
