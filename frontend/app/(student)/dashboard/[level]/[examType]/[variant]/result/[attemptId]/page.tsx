"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Award, Check, Clock3, RotateCcw, Target, Trophy, X } from "lucide-react";
import Link from "next/link";
import { api, API_URL, mediaUrl, refreshSession } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

type ReviewMedia = { id: string; file_name: string; url: string; mime_type: string };
type ReviewItem = {
  question_id: string; task_id: string; section: string; task_title?: string;
  passage_html: string | null; media: ReviewMedia | null;
  prompt: string; student_answer: unknown; correct_answer: unknown; is_correct: boolean | null; feedback?: string;
};
type Result = {
  test_variant_id: string;
  title: string; status: string; score: number; max_score: number; percentage: number;
  passing_percentage: number; passed: boolean; retake_allowed: boolean; correct_count: number; incorrect_count: number;
  pending_count: number; time_spent_seconds: number;
  sections: { title: string; score: number; max_score: number; percentage: number }[];
  review: ReviewItem[];
};

function formatAnswer(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.map(String).join(" → ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${String(item)}`)
      .join("\n");
  }
  return String(value);
}

export default function ResultPage({ params }: { params: { level: string; examType: string; variant: string; attemptId: string } }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [retaking, setRetaking] = useState(false);
  const [downloadingCertificate, setDownloadingCertificate] = useState(false);
  const router = useRouter();
  useEffect(() => {
    api<Result>(`/attempts/${params.attemptId}/result`).then(setResult)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load this result."));
  }, [params.attemptId]);
  async function retakeTest() {
    setRetaking(true);
    try {
      await api(`/tests/${params.variant}/attempts`, { method: "POST" });
      router.push(`/dashboard/${params.level}/${params.examType}/${params.variant}/attempt`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to retake this test.");
      setRetaking(false);
    }
  }
  async function downloadCertificate() {
    setDownloadingCertificate(true);
    try {
      const certificateUrl = `${API_URL}/attempts/${params.attemptId}/certificate`;
      let response = await fetch(certificateUrl, { credentials: "include" });
      if (response.status === 401 && (await refreshSession())) {
        response = await fetch(certificateUrl, { credentials: "include" });
      }
      if (!response.ok) throw new Error("Unable to generate the certificate.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `certificate-${params.attemptId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to generate the certificate.");
    } finally {
      setDownloadingCertificate(false);
    }
  }
  const reviewGroups = useMemo(() => {
    const groups: { task_id: string; task_title?: string; passage_html: string | null; media: ReviewMedia | null; items: ReviewItem[] }[] = [];
    for (const item of result?.review ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.task_id === item.task_id) last.items.push(item);
      else groups.push({ task_id: item.task_id, task_title: item.task_title, passage_html: item.passage_html, media: item.media, items: [item] });
    }
    return groups;
  }, [result]);
  const questionNumbers = useMemo(() => {
    const map = new Map<string, number>();
    (result?.review ?? []).forEach((item, index) => map.set(item.question_id, index + 1));
    return map;
  }, [result]);
  if (error) return <div className="mx-auto max-w-3xl p-8 text-center text-red-600">{error}</div>;
  if (!result) return <div className="grid min-h-[70vh] place-items-center"><span className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-brand" /></div>;
  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    <Link href="/solved-tests" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Back to Solved Tests</Link>
    <section className="mt-7 overflow-hidden rounded-3xl bg-gradient-to-br from-[#222653] to-[#4f46b8] p-7 text-white shadow-lift sm:p-10"><div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-center"><div><span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold"><Trophy className="h-4 w-4 text-amber-300" /> {result.status === "PENDING_REVIEW" ? "Pending manual review" : "Test completed"}</span><h1 className="mt-5 text-3xl font-extrabold sm:text-4xl">{result.title}</h1><p className="mt-3 text-indigo-100/80">{result.passed ? "You reached the passing score." : "Review your answers and try again."}</p><div className="mt-7 flex flex-wrap gap-5 text-sm"><span className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-300" /> {result.correct_count} correct</span><span className="flex items-center gap-2"><X className="h-4 w-4 text-rose-300" /> {result.incorrect_count} incorrect</span><span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-indigo-200" /> {formatDuration(result.time_spent_seconds)}</span></div><div className="mt-7 flex flex-wrap gap-3">{result.passed && result.status === "GRADED" && <button onClick={downloadCertificate} disabled={downloadingCertificate} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-[#0f2e24] transition hover:bg-emerald-300 disabled:opacity-60"><Award className="h-4 w-4" /> {downloadingCertificate ? "Generating…" : "Download Certificate"}</button>}{result.retake_allowed && <button onClick={retakeTest} disabled={retaking} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#222653] transition hover:bg-indigo-50 disabled:opacity-60"><RotateCcw className="h-4 w-4" /> {retaking ? "Starting…" : "Retake Test"}</button>}</div></div><div className="grid h-40 w-40 shrink-0 place-items-center rounded-full border-[10px] border-white/10 bg-white/5"><div className="text-center"><span className="block text-5xl font-extrabold">{Math.round(result.percentage)}</span><span className="text-xs font-bold uppercase tracking-wider text-indigo-200">percent</span></div></div></div></section>
    <div className="mt-6 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-line bg-canvas p-5"><p className="text-sm font-semibold text-muted">Score</p><p className="mt-2 text-2xl font-extrabold text-ink">{result.score} / {result.max_score}</p></div><div className="rounded-2xl border border-line bg-canvas p-5"><p className="text-sm font-semibold text-muted">Passing score</p><p className="mt-2 text-2xl font-extrabold text-ink">{result.passing_percentage}%</p></div><div className="rounded-2xl border border-line bg-canvas p-5"><p className="text-sm font-semibold text-muted">Result</p><p className={`mt-2 text-2xl font-extrabold ${result.passed ? "text-emerald-600" : "text-orange-600"}`}>{result.passed ? "Passed" : "Not passed"}</p></div></div>
    <section className="mt-6 rounded-3xl border border-line bg-canvas p-6"><div className="flex items-center justify-between"><div><h2 className="text-xl font-extrabold text-ink">Section breakdown</h2><p className="mt-1 text-sm text-muted">Scores calculated by the backend.</p></div><Target className="h-6 w-6 text-brand" /></div><div className="mt-6 space-y-5">{result.sections.map((section) => <div key={section.title}><div className="flex justify-between text-sm font-bold"><span className="text-ink">{section.title}</span><span className="text-muted">{Math.round(section.percentage)}%</span></div><div className="mt-2 h-2 rounded-full bg-surface"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${section.percentage}%` }} /></div></div>)}</div></section>
    {reviewGroups.length > 0 && <section className="mt-6 rounded-3xl border border-line bg-canvas p-6">
      <h2 className="text-xl font-extrabold text-ink">Answer review</h2>
      <div className="mt-5 space-y-6">{reviewGroups.map((group) => <div key={group.task_id}>
        {group.task_title && <p className="text-xs font-bold uppercase tracking-wider text-brand">{group.task_title}</p>}
        {group.media && <div className="mt-2 rounded-2xl bg-surface p-3">
          {group.media.mime_type.startsWith("image/")
            ? <img className="max-h-56 w-full rounded-xl object-contain" src={mediaUrl(group.media.url)} alt={group.media.file_name} />
            : group.media.mime_type.startsWith("video/")
              ? <video controls className="max-h-56 w-full rounded-xl bg-black" src={mediaUrl(group.media.url)} />
              : <audio controls className="h-10 w-full" src={mediaUrl(group.media.url)} />}
        </div>}
        {group.passage_html && <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-surface p-4 text-sm leading-7 text-ink">{group.passage_html}</div>}
        <div className="mt-3 space-y-3">{group.items.map((item) => <details key={item.question_id} className="rounded-2xl border border-line p-4"><summary className="cursor-pointer text-sm font-bold text-ink">{questionNumbers.get(item.question_id)}. {item.prompt.slice(0, 110)}{item.prompt.length > 110 ? "…" : ""}</summary><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl bg-surface p-3"><p className="text-xs font-bold text-muted">Your answer</p><p className="mt-1 whitespace-pre-wrap text-ink">{formatAnswer(item.student_answer, "No answer")}</p></div><div className="rounded-xl bg-surface p-3"><p className="text-xs font-bold text-muted">Correct answer</p><p className="mt-1 whitespace-pre-wrap text-ink">{formatAnswer(item.correct_answer, "Manual review")}</p></div></div></details>)}</div>
      </div>)}</div>
    </section>}
  </div>;
}
