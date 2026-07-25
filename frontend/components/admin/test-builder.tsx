"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, FileText, GripVertical, Loader2, Pencil, Plus, Save, Send, Settings, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExerciseBuilder } from "@/components/admin/exercise-builder";
import { api, ApiError, mediaUrl } from "@/lib/api";
import { sanitizeHtml } from "@/lib/sanitize";
import { answerText, binaryTypes, manualTypes } from "@/lib/question-types";

type Question = {
  id: string; prompt: string; options: string[]; correct_answer: unknown; accepted_answers: unknown[];
  points: number; explanation?: string; is_example: boolean; case_sensitive: boolean;
  normalize_spaces: boolean; order_index?: number;
};
type Task = {
  id: string; title: string; type: string; instructions: string; passage_html?: string;
  audio_replay_limit?: number; order_index?: number;
  interaction?: {
    kind?: string;
    options?: Array<string | { value: string; label: string }>;
    reuse_options?: boolean;
    template?: string;
    words?: string[];
    min_words?: number; max_words?: number; prep_seconds?: number;
    word_box?: string[];
  };
  media?: { id?: string; file_name: string; url: string; mime_type?: string }; questions: Question[];
};
type Section = { id: string; title: string; order_index: number; tasks: Task[] };
type Test = {
  id: string; title: string; instructions: string; level: string; exam_type: string;
  variant_number: number; time_limit_minutes: number; passing_percentage: number;
  retake_allowed: boolean; review_allowed: boolean; status: string; sections: Section[];
};

const letter = (i: number) => String.fromCharCode(97 + i);
const optionValue = (o: string | { value: string; label: string }) => (typeof o === "string" ? o : o.value);
const optionLabel = (o: string | { value: string; label: string }) => (typeof o === "string" ? o : o.label);
function isChosen(question: Question, value: unknown) {
  const ca = question.correct_answer;
  if (Array.isArray(ca)) return ca.map(String).includes(String(value));
  return String(ca) === String(value);
}
const chip = (correct: boolean) =>
  `rounded-lg border px-3 py-2 text-sm font-semibold ${correct ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "border-line bg-surface text-ink"}`;

// Faithful "how the student sees it" render, with the correct answer highlighted
// so the admin can verify the exercise at a glance.
function ExercisePreview({ task }: { task: Task }) {
  const kind = task.interaction?.kind;
  const options = task.interaction?.options ?? [];
  const isManual = manualTypes.has(task.type);
  const isBinary = binaryTypes.has(task.type);

  return <div className="space-y-4">
    {task.instructions && <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{task.instructions}</p>}
    {task.media && <div className="rounded-2xl bg-surface p-3">
      {task.media.mime_type?.startsWith("image/") ? <img className="max-h-72 w-full rounded-xl object-contain" src={mediaUrl(task.media.url)} alt={task.media.file_name} />
        : task.media.mime_type?.startsWith("video/") ? <video controls className="max-h-72 w-full rounded-xl bg-black" src={mediaUrl(task.media.url)} />
          : <audio controls className="h-10 w-full" src={mediaUrl(task.media.url)} />}
    </div>}
    {task.passage_html && <div className="passage-content rounded-2xl border border-line bg-surface p-4 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(task.passage_html) }} />}
    {!!task.interaction?.word_box?.length && <div className="rounded-xl border border-line bg-surface p-3 text-sm text-ink"><b className="text-brand">Word box:</b> {task.interaction.word_box.join("  ·  ")}</div>}

    {kind === "gap_match" ? (() => {
      const words = task.interaction?.words ?? [];
      const sorted = [...task.questions].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      const rows: Array<[Question, Question | undefined]> = [];
      for (let i = 0; i < sorted.length; i += 2) rows.push([sorted[i], sorted[i + 1]]);
      return <div className="space-y-3">
        <div className="rounded-xl border border-line bg-surface p-3 text-sm text-ink"><b className="text-brand">Word box:</b> {words.join("  ·  ")}</div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-2">{rows.map(([wordQ, replyQ], i) => <div key={wordQ.id} className="rounded-xl border border-line p-3 text-sm">
            <span className="font-bold text-ink">{i + 1}. {wordQ.prompt}</span>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-600">word: {String(wordQ.correct_answer ?? "—")}</span>
              <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-600">reply: {String(replyQ?.correct_answer ?? "—")}</span>
            </div>
          </div>)}</div>
          <div className="space-y-2">{options.map((o) => <div key={optionValue(o)} className="rounded-xl border border-line bg-surface p-2.5 text-xs"><b className="text-brand">{optionValue(o)}.</b> {optionLabel(o)}</div>)}</div>
        </div>
      </div>;
    })()
    : kind === "matching" || kind === "matching_headings" ? <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">{task.questions.map((q, i) => <div key={q.id} className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm">
        <span className="font-bold text-ink">{i + 1}. {q.prompt}</span>
        <span className="ml-auto rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-600">{String(q.correct_answer ?? "—")}</span>
      </div>)}</div>
      <div className="space-y-2">{options.map((o) => <div key={optionValue(o)} className="rounded-xl border border-line bg-surface p-3 text-sm"><b className="text-brand">{optionValue(o)}.</b> {optionLabel(o)}</div>)}</div>
    </div>
    : kind === "ordering" ? <div>
      <p className="mb-2 text-xs text-muted">Correct order (the student sees these shuffled):</p>
      <div className="space-y-2">{((task.questions[0]?.correct_answer as unknown[]) ?? []).map((item, i) => <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
        <span className="font-mono text-xs text-brand">{i + 1}</span><span className="text-ink">{String(item)}</span></div>)}</div>
    </div>
    : kind === "cloze_passage" ? <div>
      <div className="whitespace-pre-wrap rounded-2xl border border-line bg-surface p-4 text-sm leading-7 text-ink">{task.interaction?.template}</div>
      <div className="mt-3 space-y-1.5">{task.questions.map((q) => <div key={q.id} className="text-sm">
        <span className="font-mono text-brand">{`{{${q.order_index}}}`}</span> <span className="font-semibold text-emerald-600">{answerText(q.correct_answer)}</span>
        {q.options?.length ? <span className="text-xs text-muted"> — {q.options.map(String).join(" / ")}</span> : null}
      </div>)}</div>
    </div>
    : <div className="space-y-3">{task.questions.map((q, i) => <article key={q.id} className="rounded-2xl border border-line p-4">
      <p className="font-bold leading-7 text-ink">{q.is_example ? "e.g." : `${i + 1}.`} {q.prompt || <span className="italic text-muted">(no prompt)</span>}</p>
      {isManual ? <div className="mt-3">
        <textarea disabled className="min-h-32 w-full rounded-xl border border-line bg-surface p-3 text-sm" placeholder="Student writes here…" />
        {(task.interaction?.min_words != null || task.interaction?.max_words != null) && <p className="mt-1 text-xs text-muted">{task.interaction?.min_words ?? 0}–{task.interaction?.max_words ?? "∞"} words</p>}
        {task.interaction?.prep_seconds != null && <p className="mt-1 text-xs text-muted">Preparation: {task.interaction.prep_seconds}s</p>}
      </div>
      : isBinary ? <div className="mt-3 flex flex-wrap gap-2">{(task.type === "true_false_not_given" ? ["True", "False", "Not Given"] : ["True", "False"]).map((v) => <span key={v} className={chip(isChosen(q, v))}>{v}</span>)}</div>
      : q.options && q.options.length ? <div className="mt-3 flex flex-wrap gap-2">{q.options.map((o, oi) => <span key={oi} className={chip(isChosen(q, o))}>{letter(oi)}. {String(o)}</span>)}</div>
      : <div className="mt-3">
        <span className="inline-block min-w-40 rounded-lg border border-dashed border-line bg-surface px-3 py-2 text-sm text-muted">answer…</span>
        {q.correct_answer != null && q.correct_answer !== "" && <span className="ml-2 text-sm font-semibold text-emerald-600">✓ {answerText(q.correct_answer)}</span>}
        {q.accepted_answers?.length ? <span className="ml-2 text-xs text-muted">(also: {q.accepted_answers.map(String).join(", ")})</span> : null}
      </div>}
      {q.explanation && <p className="mt-2 text-xs text-muted">💡 {q.explanation}</p>}
    </article>)}</div>}
  </div>;
}

export function TestBuilder({ variantId }: { variantId: string }) {
  const [test, setTest] = useState<Test | null>(null);
  const [taskId, setTaskId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The adaptive builder, open either to add (no task) or edit (task set) an exercise.
  const [builder, setBuilder] = useState<{ task?: Task } | null>(null);
  // Test-level settings (instructions, timing, pass mark, retake/review) live in
  // a collapsible panel — most edits are exercise-level, so this stays out of the way.
  const [showSettings, setShowSettings] = useState(false);
  // Exercise currently being dragged to reorder (null = none).
  const [dragId, setDragId] = useState<string | null>(null);
  // Whole-document AI import state.
  const [importingDoc, setImportingDoc] = useState(false);
  const [importingKey, setImportingKey] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  function loadTest() {
    return api<Test>(`/admin/tests/${variantId}`).then((value) => {
      setTest(value);
      const firstTask = value.sections.flatMap((s) => s.tasks)[0];
      setTaskId((current) => current || firstTask?.id || "");
      return value;
    });
  }

  useEffect(() => {
    loadTest().catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load test."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId]);

  // Sections are an internal grouping the admin never sees — the builder shows a
  // single flat list of exercises for the whole test.
  const exercises = useMemo(() => test?.sections.flatMap((s) => s.tasks) ?? [], [test]);
  const task = useMemo(() => exercises.find((item) => item.id === taskId), [exercises, taskId]);

  function notify(text: string) { setError(""); setMessage(text); }
  function fail(reason: unknown, fallback: string) {
    setMessage("");
    setError(reason instanceof Error ? reason.message : fallback);
  }

  async function saveTest() {
    if (!test) return;
    setBusy(true);
    try {
      await api(`/admin/tests/${test.id}`, { method: "PATCH", body: JSON.stringify({
        title: test.title, instructions: test.instructions, time_limit_minutes: test.time_limit_minutes,
        passing_percentage: test.passing_percentage, retake_allowed: test.retake_allowed,
        review_allowed: test.review_allowed,
      }) });
      notify("Test settings saved.");
    } catch (reason) { fail(reason, "Unable to save test."); }
    finally { setBusy(false); }
  }

  async function duplicateTask() {
    if (!task) return;
    try {
      const created = await api<{ id: string }>(`/admin/tasks/${task.id}/duplicate`, { method: "POST" });
      await loadTest();
      setTaskId(created.id);
      notify("Exercise duplicated.");
    } catch (reason) { fail(reason, "Unable to duplicate this exercise."); }
  }

  async function removeTask() {
    if (!test || !task || !window.confirm("Delete this exercise and all of its questions?")) return;
    try {
      await api(`/admin/tasks/${task.id}`, { method: "DELETE" });
      const value = await loadTest();
      setTaskId(value.sections.flatMap((s) => s.tasks)[0]?.id ?? "");
      notify("Exercise deleted.");
    } catch (reason) { fail(reason, "Unable to delete exercise."); }
  }

  async function togglePublished() {
    if (!test) return;
    setImportWarnings([]);
    try {
      const action = test.status === "PUBLISHED" ? "unpublish" : "publish";
      const result = await api<{ status: string }>(`/admin/tests/${test.id}/${action}`, { method: "POST" });
      setTest({ ...test, status: result.status });
      notify(result.status === "PUBLISHED" ? "Test published." : "Test moved to draft.");
    } catch (reason) {
      // The quality gate returns a structured report — show each problem as
      // its own line so the admin can fix them one by one.
      if (reason instanceof ApiError && reason.detail && typeof reason.detail === "object") {
        const detail = reason.detail as { message?: string; errors?: Array<{ scope?: string; message?: string } | string> };
        if (Array.isArray(detail.errors) && detail.errors.length) {
          setMessage("");
          setError(detail.message ?? "Quality check failed — fix the issues below and publish again.");
          setImportWarnings(detail.errors.map((item) =>
            typeof item === "string" ? item : `${item.scope ? `${item.scope} — ` : ""}${item.message ?? ""}`,
          ));
          return;
        }
      }
      fail(reason, "Unable to change publication status.");
    }
  }

  // Drag-and-drop reorder: move the dragged exercise to the drop target's slot,
  // reflect it immediately, and persist the new order.
  function onDropExercise(targetId: string) {
    if (!dragId || dragId === targetId || !test) { setDragId(null); return; }
    const ids = exercises.map((item) => item.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    const pos = new Map(ids.map((id, index) => [id, index]));
    setTest({
      ...test,
      sections: test.sections.map((s) => ({
        ...s, tasks: [...s.tasks].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)),
      })),
    });
    api(`/admin/tests/${variantId}/reorder-tasks`, { method: "POST", body: JSON.stringify({ task_ids: ids }) })
      .catch((reason) => fail(reason, "Unable to save the new order."));
  }

  // AI import of a whole test paper: the backend splits the .docx into
  // exercises, detects each type, and creates them all in this test.
  async function importDoc(file: File) {
    setImportingDoc(true); setImportWarnings([]); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<{ created: number; warnings: string[] }>(
        `/admin/tests/${variantId}/import-docx`, { method: "POST", body: form },
      );
      await loadTest();
      notify(`Imported ${r.created} exercise(s) from the document. Review answers and add audio before publishing.`);
      setImportWarnings(r.warnings ?? []);
    } catch (reason) { fail(reason, "Could not import this document."); }
    finally { setImportingDoc(false); }
  }

  // AI import of an answer key: matches the document's answers to the test's
  // existing questions and updates their correct answers.
  async function importAnswers(file: File) {
    setImportingKey(true); setImportWarnings([]); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<{ updated: number; warnings: string[] }>(
        `/admin/tests/${variantId}/import-answers`, { method: "POST", body: form },
      );
      await loadTest();
      notify(`Updated ${r.updated} answer(s) from the key. Check the highlighted answers in each exercise.`);
      setImportWarnings(r.warnings ?? []);
    } catch (reason) { fail(reason, "Could not import the answer key."); }
    finally { setImportingKey(false); }
  }

  function onBuilderSaved() {
    if (!builder) return;
    const editedId = builder.task?.id;
    setBuilder(null);
    loadTest().then((value) => {
      const all = value.sections.flatMap((s) => s.tasks);
      setTaskId(editedId ?? all[all.length - 1]?.id ?? "");
    }).catch(() => {});
    notify(editedId ? "Exercise updated." : "Exercise saved.");
  }

  if (error && !test) return <div className="p-8 text-red-600">{error}</div>;
  if (!test) return <div className="grid min-h-[70vh] place-items-center"><span className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-brand" /></div>;

  return <div className="min-h-[calc(100vh-64px)]">
    <div className="flex flex-col justify-between gap-4 border-b border-line bg-canvas px-4 py-4 sm:flex-row sm:items-center sm:px-8">
      <div>
        <p className="text-xs font-bold text-brand">{test.level} · {test.exam_type} · Variant {test.variant_number} · {test.status}</p>
        <Input className="mt-1 h-10 max-w-lg border-0 px-0 text-xl font-extrabold" value={test.title} onChange={(event) => setTest({ ...test, title: event.target.value })} />
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setShowSettings((v) => !v)}><Settings className="h-4 w-4" /> Test Settings</Button>
        <Button variant="secondary" onClick={togglePublished}>{test.status === "PUBLISHED" ? <Undo2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}{test.status === "PUBLISHED" ? "Move to Draft" : "Publish"}</Button>
        <Button onClick={saveTest} disabled={busy}><Save className="h-4 w-4" /> Save Test</Button>
      </div>
    </div>
    {showSettings && <div className="mx-4 mt-4 space-y-4 rounded-2xl border border-line bg-canvas p-4 sm:mx-8">
      <label className="block text-xs font-bold text-muted">Test instructions (shown to the student before they start)
        <textarea
          value={test.instructions}
          onChange={(event) => setTest({ ...test, instructions: event.target.value })}
          className="mt-1 min-h-[80px] w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-brand"
          placeholder="Read each section carefully before answering."
        />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="text-xs font-bold text-muted">Time limit (minutes)
          <input type="number" min={1} value={test.time_limit_minutes}
            onChange={(event) => setTest({ ...test, time_limit_minutes: +event.target.value })}
            className="mt-1 block w-28 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
        </label>
        <label className="text-xs font-bold text-muted">Passing percentage
          <input type="number" min={0} max={100} value={test.passing_percentage}
            onChange={(event) => setTest({ ...test, passing_percentage: +event.target.value })}
            className="mt-1 block w-28 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-xs font-bold text-muted">
          <input type="checkbox" checked={test.retake_allowed} onChange={(event) => setTest({ ...test, retake_allowed: event.target.checked })} /> Retake allowed
        </label>
        <label className="flex items-center gap-1.5 text-xs font-bold text-muted">
          <input type="checkbox" checked={test.review_allowed} onChange={(event) => setTest({ ...test, review_allowed: event.target.checked })} /> Review allowed after submit
        </label>
      </div>
    </div>}
    {(message || error) && <p className={`mx-4 mt-4 rounded-xl p-3 text-sm font-semibold sm:mx-8 ${error ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-700"}`}>{error || message}</p>}
    {importWarnings.length > 0 && <div className="mx-4 mt-3 rounded-xl border border-amber-300 bg-amber-500/10 p-3 sm:mx-8">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-amber-700">Review needed ({importWarnings.length})</p>
        <button onClick={() => setImportWarnings([])} className="text-xs font-semibold text-amber-700 hover:underline">Dismiss</button>
      </div>
      <ul className="mt-1.5 max-h-48 space-y-1 overflow-auto">
        {importWarnings.map((w, i) => <li key={i} className="text-xs leading-5 text-amber-800">• {w}</li>)}
      </ul>
    </div>}
    <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="max-h-[calc(100vh-130px)] overflow-auto border-r border-line bg-canvas p-4">
        <div className="flex items-center justify-between px-1"><p className="text-xs font-bold uppercase tracking-wider text-muted">Exercises</p><span className="text-xs text-muted">{exercises.length}</span></div>
        <div className="mt-3 space-y-1">
          {exercises.map((item, index) => <div
            key={item.id}
            draggable
            onDragStart={() => setDragId(item.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDropExercise(item.id)}
            className={`flex items-center gap-1 rounded-lg pr-2 transition ${taskId === item.id ? "bg-indigo-500/5 ring-1 ring-indigo-200" : "hover:bg-surface"} ${dragId === item.id ? "opacity-40" : ""}`}
          >
            <span className="grid h-full cursor-grab place-items-center py-2.5 pl-1.5 text-muted active:cursor-grabbing" title="Drag to reorder"><GripVertical className="h-4 w-4" /></span>
            <button onClick={() => setTaskId(item.id)} className="min-w-0 flex-1 py-2.5 text-left text-xs font-semibold">
              <span className={taskId === item.id ? "text-brand" : "text-ink"}>{index + 1}. {item.title}</span>
              <span className="block text-[10px] font-normal text-muted">{item.type} · {item.questions.length} questions</span>
            </button>
          </div>)}
          {exercises.length === 0 && <p className="px-1 py-4 text-xs text-muted">No exercises yet.</p>}
        </div>
        <Button className="mt-4 w-full" size="sm" onClick={() => setBuilder({})}><Plus className="h-4 w-4" /> Add exercise</Button>
        <label className={`mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand bg-brand/5 px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/10 ${importingDoc ? "pointer-events-none opacity-60" : ""}`}>
          {importingDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {importingDoc ? "Analyzing document…" : "Import test from Word"}
          <input type="file" accept=".docx" className="hidden" disabled={importingDoc}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importDoc(f); e.target.value = ""; }} />
        </label>
        {importingDoc && <p className="mt-1.5 px-1 text-[10px] leading-4 text-muted">The AI is splitting the document into exercises and detecting question types. This can take a minute…</p>}
        <label className={`mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-500 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/10 ${importingKey || exercises.length === 0 ? "pointer-events-none opacity-50" : ""}`}>
          {importingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {importingKey ? "Matching answers…" : "Import answers from Word"}
          <input type="file" accept=".docx" className="hidden" disabled={importingKey || exercises.length === 0}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importAnswers(f); e.target.value = ""; }} />
        </label>
        {importingKey && <p className="mt-1.5 px-1 text-[10px] leading-4 text-muted">The AI is matching the answer key to this test&apos;s questions…</p>}
      </aside>
      <main className="bg-surface p-4 sm:p-7">
        {task ? <div className="w-full">
          <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-brand">Student preview</p>
              <h2 className="mt-1 text-2xl font-extrabold text-ink">{task.title}</h2>
              <p className="mt-0.5 text-xs text-muted">{task.type} · {task.questions.length} questions</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setBuilder({ task })}><Pencil className="h-4 w-4" /> Edit</Button>
              <Button size="sm" variant="secondary" onClick={duplicateTask}><Copy className="h-4 w-4" /> Duplicate</Button>
              <Button size="sm" variant="danger" onClick={removeTask}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="mt-6"><ExercisePreview task={task} /></div>
        </div> : <div className="grid min-h-[40vh] place-items-center rounded-3xl border border-dashed border-line p-10 text-center">
          <p className="text-sm text-muted">No exercise selected. Press <b>Add exercise</b> to create one.</p>
        </div>}
      </main>
    </div>
    {builder && <ExerciseBuilder
      testId={test.id}
      label={`${test.level} · ${test.exam_type}`}
      exerciseNumber={builder.task ? exercises.findIndex((t) => t.id === builder.task!.id) + 1 : exercises.length + 1}
      task={builder.task}
      onClose={() => setBuilder(null)}
      onSaved={onBuilderSaved}
    />}
  </div>;
}
