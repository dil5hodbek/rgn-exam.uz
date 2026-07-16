"use client";
import { useEffect, useRef, useState } from "react";
import { FilePenLine, Highlighter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

type Submission = {
  id: string; attempt_id: string; question_id: string; answer: unknown;
  prompt: string; max_points: number; test_title: string; student_name: string;
};
type Annotation = { start: number; end: number; comment: string };

// Render the answer with the marked errors highlighted; each mark shows its
// number so it can be matched with the comment list below.
function AnnotatedText({ text, annotations, containerRef }: {
  text: string;
  annotations: Annotation[];
  containerRef?: React.RefObject<HTMLDivElement>;
}) {
  const sorted = [...annotations].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((mark, index) => {
    const start = Math.max(cursor, Math.min(mark.start, text.length));
    const end = Math.max(start, Math.min(mark.end, text.length));
    if (start > cursor) parts.push(<span key={`t-${index}`}>{text.slice(cursor, start)}</span>);
    parts.push(
      <mark key={`m-${index}`} className="rounded bg-red-500/15 px-0.5 text-red-600 underline decoration-red-400 decoration-wavy underline-offset-4 dark:text-red-400">
        {text.slice(start, end)}
        <sup className="ml-0.5 font-bold">{index + 1}</sup>
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <div ref={containerRef} className="whitespace-pre-wrap rounded-xl bg-surface p-4 text-sm leading-7 text-ink">{parts.length ? parts : text}</div>;
}

function ReviewCard({ row, onGraded, onError }: {
  row: Submission;
  onGraded: (id: string) => void;
  onError: (message: string) => void;
}) {
  const text = String(row.answer ?? "");
  const answerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pending, setPending] = useState<{ start: number; end: number; text: string } | null>(null);
  const [comment, setComment] = useState("");
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  // Selection → plain-text offsets inside the answer container. The container
  // may hold <mark> highlights and their superscript numbers — the sup digits
  // are not part of the answer text, so their length is subtracted.
  function offsetAt(container: HTMLElement, node: Node, nodeOffset: number) {
    const measure = document.createRange();
    measure.selectNodeContents(container);
    measure.setEnd(node, nodeOffset);
    let length = measure.toString().length;
    container.querySelectorAll("sup").forEach((sup) => {
      const supRange = document.createRange();
      supRange.selectNodeContents(sup);
      if (supRange.compareBoundaryPoints(Range.END_TO_END, measure) <= 0) {
        length -= (sup.textContent ?? "").length;
      }
    });
    return length;
  }

  function captureSelection() {
    const container = answerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const start = Math.max(0, Math.min(offsetAt(container, range.startContainer, range.startOffset), text.length));
    const end = Math.max(start, Math.min(offsetAt(container, range.endContainer, range.endOffset), text.length));
    if (end <= start) return;
    setPending({ start, end, text: text.slice(start, end) });
  }

  function addAnnotation() {
    if (!pending) return;
    setAnnotations((current) => [...current, { start: pending.start, end: pending.end, comment: comment.trim() }]);
    setPending(null);
    setComment("");
    window.getSelection()?.removeAllRanges();
  }

  async function grade() {
    setSaving(true);
    try {
      await api(`/admin/attempt-answers/${row.id}/grade`, {
        method: "POST",
        body: JSON.stringify({
          points_awarded: Number(score || 0),
          feedback,
          rubric_scores: {},
          annotations,
        }),
      });
      onGraded(row.id);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Unable to save grade.");
      setSaving(false);
    }
  }

  const sorted = [...annotations].sort((a, b) => a.start - b.start);

  return <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500/10 text-orange-500"><FilePenLine className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-ink">{row.student_name}</p>
          <p className="truncate text-xs text-muted">{row.test_title}</p>
        </div>
      </div>
      <p className="mt-3 rounded-xl border border-line bg-canvas p-3 text-sm font-semibold text-ink">{row.prompt}</p>
      <p className="mb-1.5 mt-4 flex items-center gap-1.5 text-xs font-bold text-muted"><Highlighter className="h-3.5 w-3.5" /> Select any wrong fragment in the answer, then press “Mark error”.</p>
      <div onMouseUp={captureSelection}>
        <AnnotatedText text={text} annotations={annotations} containerRef={answerRef} />
      </div>
      {pending && <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-500/5 p-2.5">
        <span className="max-w-60 truncate rounded bg-red-500/10 px-2 py-1 text-xs font-bold text-red-600">“{pending.text}”</span>
        <Input className="h-9 min-w-40 flex-1" placeholder="Correction / note (optional)" value={comment} onChange={(event) => setComment(event.target.value)} />
        <Button size="sm" variant="danger" onClick={addAnnotation}><Highlighter className="h-3.5 w-3.5" /> Mark error</Button>
        <button onClick={() => { setPending(null); setComment(""); }} className="rounded-lg p-1.5 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
      </div>}
      {sorted.length > 0 && <ol className="mt-3 space-y-1.5">
        {sorted.map((mark, index) => <li key={`${mark.start}-${index}`} className="flex items-start gap-2 text-xs leading-5">
          <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded bg-red-500/10 font-bold text-red-600">{index + 1}</span>
          <span className="min-w-0 text-ink"><b className="text-red-600">“{text.slice(mark.start, mark.end)}”</b>{mark.comment ? <> — {mark.comment}</> : null}</span>
          <button onClick={() => setAnnotations(annotations.filter((item) => item !== mark))} className="ml-auto shrink-0 text-muted hover:text-ink"><X className="h-3.5 w-3.5" /></button>
        </li>)}
      </ol>}
    </div>
    <div className="space-y-3 lg:border-l lg:border-line lg:pl-5">
      <label className="block text-xs font-bold text-muted">Points (max {row.max_points})
        <Input className="mt-1 h-10" type="number" min="0" max={row.max_points} step="0.5"
          value={score} onChange={(event) => setScore(event.target.value)} />
      </label>
      <label className="block text-xs font-bold text-muted">Feedback for the student
        <textarea
          className="mt-1 min-h-28 w-full resize-y rounded-xl border border-line bg-canvas p-3 text-sm text-ink outline-none focus:border-brand"
          placeholder="What was good, what to improve…"
          value={feedback} onChange={(event) => setFeedback(event.target.value)}
        />
      </label>
      {annotations.length > 0 && <p className="text-xs font-semibold text-muted">{annotations.length} error(s) marked — the student will see them highlighted.</p>}
      <Button className="w-full" onClick={grade} disabled={saving}>{saving ? "Saving…" : "Save Grade"}</Button>
    </div>
  </div>;
}

export default function TeacherReview() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Submission[]>("/admin/submissions/pending").then(setRows).catch((reason) => setError(String(reason)));
  }, []);
  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Manual grading</p>
    <h1 className="mt-2 text-3xl font-extrabold text-ink">Teacher Review</h1>
    <p className="mt-2 text-sm text-muted">Writing and speaking answers waiting for a teacher. Mark errors right inside the student’s text, add feedback and a score.</p>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-7 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-canvas">
      {rows.length
        ? rows.map((row) => <ReviewCard key={row.id} row={row}
            onGraded={(id) => setRows((current) => current.filter((item) => item.id !== id))}
            onError={setError} />)
        : <p className="p-10 text-center text-sm text-muted">No submissions awaiting review. 🎉</p>}
    </div>
  </div>;
}
