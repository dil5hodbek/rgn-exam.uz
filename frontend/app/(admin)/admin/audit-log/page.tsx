"use client";
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { api } from "@/lib/api";
type Log = { id: string; action: string; entity_type: string; entity_id?: string; ip_address?: string; created_at: string };
export default function AuditLog() {
  const [rows, setRows] = useState<Log[]>([]);
  useEffect(() => { api<Log[]>("/admin/audit-log").then(setRows); }, []);
  return <div className="mx-auto max-w-6xl p-4 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Security</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Audit Log</h1><p className="mt-2 text-sm text-muted">Real administrator mutations only.</p><div className="mt-7 overflow-hidden rounded-2xl border border-line bg-canvas">{rows.length ? rows.map((row, index) => <div key={row.id} className={`flex items-center gap-4 p-5 ${index ? "border-t border-line" : ""}`}><Activity className="h-4 w-4 text-brand" /><div className="flex-1"><p className="font-mono text-xs font-bold text-ink">{row.action} · {row.entity_type}</p><p className="mt-1 text-xs text-muted">{row.entity_id ?? "—"} · {row.ip_address ?? "unknown IP"}</p></div><span className="text-xs text-muted">{new Date(row.created_at).toLocaleString()}</span></div>) : <p className="p-10 text-center text-sm text-muted">No audit events yet.</p>}</div></div>;
}
