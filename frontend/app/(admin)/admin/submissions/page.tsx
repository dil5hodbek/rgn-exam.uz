"use client";
import { useEffect, useState } from "react";
import { FilePenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
type Submission = {
  id: string; attempt_id: string; question_id: string; answer: unknown;
  prompt: string; max_points: number; test_title: string; student_name: string;
};
export default function Submissions() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => { api<Submission[]>("/admin/submissions/pending").then(setRows).catch((reason) => setError(String(reason))); }, []);
  async function grade(row: Submission) {
    setError("");
    try {
      await api(`/admin/attempt-answers/${row.id}/grade`, { method: "POST", body: JSON.stringify({ points_awarded: Number(scores[row.id] ?? 0), feedback: feedback[row.id] ?? "", rubric_scores: {} }) });
      setRows(rows.filter((item) => item.id !== row.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save grade."); }
  }
  return <div className="mx-auto max-w-6xl p-4 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Manual grading</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Submissions</h1><p className="mt-2 text-sm text-muted">Writing and low-confidence answers awaiting review.</p>{error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}<div className="mt-7 overflow-hidden rounded-2xl border border-line bg-canvas">{rows.length ? rows.map((row, index) => <div key={row.id} className={`grid gap-4 p-5 lg:grid-cols-[44px_1fr_280px] ${index ? "border-t border-line" : ""}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange-500/10 text-orange-500"><FilePenLine className="h-5 w-5" /></span><div className="min-w-0"><p className="text-xs font-bold text-muted">{row.student_name} · {row.test_title}</p><p className="mt-2 text-sm font-bold text-ink">{row.prompt}</p><p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface p-3 text-sm text-ink">{String(row.answer ?? "No answer")}</p></div><div className="space-y-3"><label className="text-xs font-bold text-muted">Points (max {row.max_points})<Input className="mt-1 h-10" type="number" min="0" max={row.max_points} step="0.1" value={scores[row.id] ?? ""} onChange={(event) => setScores({ ...scores, [row.id]: event.target.value })} /></label><Input placeholder="Feedback (optional)" value={feedback[row.id] ?? ""} onChange={(event) => setFeedback({ ...feedback, [row.id]: event.target.value })} /><Button className="w-full" size="sm" onClick={() => grade(row)}>Save Grade</Button></div></div>) : <p className="p-10 text-center text-sm text-muted">No submissions awaiting review.</p>}</div></div>;
}
