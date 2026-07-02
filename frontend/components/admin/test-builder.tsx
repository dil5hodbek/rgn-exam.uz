"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Eye, Headphones, Pencil, Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuestionFields } from "@/components/admin/question-editor/QuestionFields";
import { QuestionTypeSelect } from "@/components/admin/question-editor/QuestionTypeSelect";
import { api, mediaUrl } from "@/lib/api";
import { binaryTypes, defaultKind, manualTypes, parseAnswer } from "@/lib/question-types";

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
  };
  media?: { file_name: string; url: string; mime_type?: string }; questions: Question[];
};
type Section = { id: string; title: string; order_index: number; tasks: Task[] };
type Test = {
  id: string; title: string; instructions: string; level: string; exam_type: string;
  variant_number: number; time_limit_minutes: number; passing_percentage: number;
  retake_allowed: boolean; review_allowed: boolean; status: string; sections: Section[];
};

export function TestBuilder({ variantId }: { variantId: string }) {
  const [test, setTest] = useState<Test | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [qualityErrors, setQualityErrors] = useState<Array<{ scope: string; message: string }>>([]);

  useEffect(() => {
    api<Test>(`/admin/tests/${variantId}`).then((value) => {
      setTest(value);
      const firstSection = value.sections[0];
      const firstTask = firstSection?.tasks[0];
      setSectionId(firstSection?.id ?? "");
      setTaskId(firstTask?.id ?? "");
      setQuestionId(firstTask?.questions[0]?.id ?? "");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load test."));
  }, [variantId]);

  const section = useMemo(
    () => test?.sections.find((item) => item.id === sectionId),
    [test, sectionId],
  );
  const task = useMemo(
    () => test?.sections.flatMap((item) => item.tasks).find((item) => item.id === taskId),
    [test, taskId],
  );
  const question = useMemo(
    () => task?.questions.find((item) => item.id === questionId),
    [task, questionId],
  );

  function notify(text: string) { setError(""); setMessage(text); }
  function fail(reason: unknown, fallback: string) {
    setMessage("");
    setError(reason instanceof Error ? reason.message : fallback);
  }
  function updateSection(changes: Partial<Section>) {
    if (!test) return;
    setTest({ ...test, sections: test.sections.map((item) => item.id === sectionId ? { ...item, ...changes } : item) });
  }
  function updateTask(changes: Partial<Task>) {
    if (!test) return;
    setTest({
      ...test,
      sections: test.sections.map((group) => ({
        ...group,
        tasks: group.tasks.map((item) => item.id === taskId ? { ...item, ...changes } : item),
      })),
    });
  }
  function updateQuestion(changes: Partial<Question>) {
    if (!task || !question) return;
    updateTask({ questions: task.questions.map((item) => item.id === question.id ? { ...item, ...changes } : item) });
  }
  // Kinds an admin can pick explicitly from the interaction dropdown — left
  // alone on a type change since they were a deliberate choice, not a stale default.
  const explicitInteractionKinds = new Set(["word_bank", "matching", "inline_alternatives", "cloze_passage", "ordering"]);
  function updateTaskType(newType: string) {
    const currentKind = task?.interaction?.kind;
    const interaction = currentKind && explicitInteractionKinds.has(currentKind)
      ? task?.interaction
      : { ...(task?.interaction ?? {}), kind: defaultKind(newType) };
    updateTask({ type: newType, interaction });
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

  async function saveSection() {
    if (!section) return;
    try {
      await api(`/admin/sections/${section.id}`, {
        method: "PATCH", body: JSON.stringify({ title: section.title }),
      });
      notify("Section saved.");
    } catch (reason) { fail(reason, "Unable to save section."); }
  }

  async function saveTask() {
    if (!task) return;
    try {
      await api(`/admin/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({
        title: task.title, instructions: task.instructions, type: task.type,
        passage_html: task.passage_html || null, audio_replay_limit: task.audio_replay_limit || null,
        interaction: task.interaction ?? {},
      }) });
      notify("Task saved.");
    } catch (reason) { fail(reason, "Unable to save task."); }
  }

  async function saveQuestion() {
    if (!question) return;
    try {
      await api(`/admin/questions/${question.id}`, { method: "PATCH", body: JSON.stringify({
        prompt: question.prompt, options: question.options,
        correct_answer: parseAnswer(question.correct_answer),
        accepted_answers: question.accepted_answers,
        points: question.points, explanation: question.explanation || null,
        is_example: question.is_example, case_sensitive: question.case_sensitive,
        normalize_spaces: question.normalize_spaces,
      }) });
      notify("Question and answer saved.");
    } catch (reason) { fail(reason, "Unable to save question."); }
  }

  async function addSection() {
    if (!test) return;
    try {
      const created = await api<Section>(`/admin/tests/${test.id}/sections`, {
        method: "POST", body: JSON.stringify({ title: `Section ${test.sections.length + 1}` }),
      });
      setTest({ ...test, sections: [...test.sections, created] });
      setSectionId(created.id); setTaskId(""); setQuestionId("");
      notify("Section added. Rename it and save.");
    } catch (reason) { fail(reason, "Unable to add section."); }
  }

  async function addTask(targetSectionId: string) {
    if (!test) return;
    try {
      const created = await api<Task>(`/admin/sections/${targetSectionId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: "New task", instructions: "Complete the task.", type: "multiple_choice",
          passage_html: null, audio_replay_limit: null,
        }),
      });
      setTest({
        ...test,
        sections: test.sections.map((item) => item.id === targetSectionId
          ? { ...item, tasks: [...item.tasks, created] } : item),
      });
      setSectionId(targetSectionId); setTaskId(created.id); setQuestionId("");
      notify("Task added.");
    } catch (reason) { fail(reason, "Unable to add task."); }
  }

  async function addQuestion() {
    if (!task) return;
    try {
      const created = await api<Question>(`/admin/tasks/${task.id}/questions`, {
        method: "POST",
        body: JSON.stringify({
          prompt: "New question", options: [], correct_answer: null, accepted_answers: [],
          points: 1, explanation: null, is_example: false, case_sensitive: false,
          normalize_spaces: true,
        }),
      });
      updateTask({ questions: [...task.questions, created] });
      setQuestionId(created.id);
      notify("Question added. Add its prompt and answer.");
    } catch (reason) { fail(reason, "Unable to add question."); }
  }

  async function removeQuestion() {
    if (!task || !question || !window.confirm("Delete this question?")) return;
    try {
      await api(`/admin/questions/${question.id}`, { method: "DELETE" });
      const remaining = task.questions.filter((item) => item.id !== question.id);
      updateTask({ questions: remaining });
      setQuestionId(remaining[0]?.id ?? "");
      notify("Question deleted.");
    } catch (reason) { fail(reason, "Unable to delete question."); }
  }

  async function removeTask() {
    if (!test || !task || !window.confirm("Delete this task and all of its questions?")) return;
    try {
      await api(`/admin/tasks/${task.id}`, { method: "DELETE" });
      const updated = test.sections.map((item) => ({ ...item, tasks: item.tasks.filter((row) => row.id !== task.id) }));
      const currentSection = updated.find((item) => item.id === sectionId);
      setTest({ ...test, sections: updated });
      setTaskId(currentSection?.tasks[0]?.id ?? "");
      setQuestionId(currentSection?.tasks[0]?.questions[0]?.id ?? "");
      notify("Task deleted.");
    } catch (reason) { fail(reason, "Unable to delete task."); }
  }

  async function removeSection() {
    if (!test || !section || !window.confirm("Delete this section and all of its tasks?")) return;
    try {
      await api(`/admin/sections/${section.id}`, { method: "DELETE" });
      const remaining = test.sections.filter((item) => item.id !== section.id);
      setTest({ ...test, sections: remaining });
      setSectionId(remaining[0]?.id ?? "");
      setTaskId(remaining[0]?.tasks[0]?.id ?? "");
      setQuestionId(remaining[0]?.tasks[0]?.questions[0]?.id ?? "");
      notify("Section deleted.");
    } catch (reason) { fail(reason, "Unable to delete section."); }
  }

  async function togglePublished() {
    if (!test) return;
    try {
      const action = test.status === "PUBLISHED" ? "unpublish" : "publish";
      const result = await api<{ status: string }>(`/admin/tests/${test.id}/${action}`, { method: "POST" });
      setTest({ ...test, status: result.status });
      notify(result.status === "PUBLISHED" ? "Test published." : "Test moved to draft.");
    } catch (reason) { fail(reason, "Unable to change publication status."); }
  }

  async function runQualityCheck() {
    if (!test) return;
    try {
      const report = await api<{ valid: boolean; errors: Array<{ scope: string; message: string }> }>(
        `/admin/tests/${test.id}/quality-check`,
        { method: "POST" },
      );
      setQualityErrors(report.errors);
      notify(report.valid ? "Quality check passed. This test is ready to publish." : `Quality check found ${report.errors.length} issue(s).`);
    } catch (reason) { fail(reason, "Unable to check test quality."); }
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
        <Button variant="secondary" onClick={() => setPreview((value) => !value)}>{preview ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{preview ? "Edit mode" : "Student preview"}</Button>
        <Button variant="secondary" onClick={runQualityCheck}><Check className="h-4 w-4" /> Quality Check</Button>
        <Button variant="secondary" onClick={togglePublished}>{test.status === "PUBLISHED" ? <Undo2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}{test.status === "PUBLISHED" ? "Move to Draft" : "Publish"}</Button>
        <Button onClick={saveTest} disabled={busy}><Save className="h-4 w-4" /> Save Test</Button>
      </div>
    </div>
    {(message || error) && <p className={`mx-4 mt-4 rounded-xl p-3 text-sm font-semibold sm:mx-8 ${error ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-700"}`}>{error || message}</p>}
    {qualityErrors.length > 0 && <div className="mx-4 mt-3 max-h-48 overflow-auto rounded-xl border border-red-200 bg-red-500/5 p-3 text-xs text-red-700 sm:mx-8">{qualityErrors.map((item, index) => <p key={`${item.scope}-${index}`} className="py-1"><strong>{item.scope}:</strong> {item.message}</p>)}</div>}
    <div className={`grid ${preview ? "lg:grid-cols-[240px_minmax(0,1fr)]" : "lg:grid-cols-[240px_minmax(0,1fr)_340px]"}`}>
      <aside className="max-h-[calc(100vh-130px)] overflow-auto border-r border-line bg-canvas p-4">
        <div className="flex items-center justify-between px-2"><p className="text-xs font-bold uppercase tracking-wider text-muted">Test structure</p><Button size="icon" variant="ghost" aria-label="Add section" onClick={addSection}><Plus className="h-4 w-4" /></Button></div>
        {test.sections.map((group) => <div key={group.id} className={`mt-4 rounded-xl p-3 ${sectionId === group.id ? "bg-indigo-500/5 ring-1 ring-indigo-200" : "bg-surface"}`}>
          <button className="w-full text-left text-sm font-extrabold text-ink" onClick={() => { setSectionId(group.id); setTaskId(group.tasks[0]?.id ?? ""); setQuestionId(group.tasks[0]?.questions[0]?.id ?? ""); }}>{group.title}</button>
          <div className="mt-2 space-y-1">{group.tasks.map((item) => <button key={item.id} onClick={() => { setSectionId(group.id); setTaskId(item.id); setQuestionId(item.questions[0]?.id ?? ""); }} className={`w-full rounded-lg px-2 py-2 text-left text-xs font-semibold ${taskId === item.id ? "bg-canvas text-brand shadow-sm" : "text-muted"}`}>{item.title}<span className="block text-[10px] font-normal">{item.type} · {item.questions.length} questions</span></button>)}</div>
          <Button className="mt-2 w-full" size="sm" variant="ghost" onClick={() => addTask(group.id)}><Plus className="h-3 w-3" /> Add task</Button>
        </div>)}
      </aside>
      <main className="bg-surface p-4 sm:p-7">
        {preview ? <div className="mx-auto max-w-5xl">
          {task ? <section className="rounded-3xl border border-line bg-canvas p-5 shadow-sm sm:p-8">
            <p className="text-xs font-bold uppercase tracking-wider text-brand">Student preview · {section?.title}</p>
            <h2 className="mt-2 text-2xl font-extrabold text-ink">{task.title}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{task.instructions}</p>
            {task.media && <div className="mt-5 rounded-2xl bg-surface p-3">{task.media.mime_type?.startsWith("video/") ? <video controls className="max-h-52 w-full rounded-xl bg-black" src={mediaUrl(task.media.url)} /> : <audio controls className="h-10 w-full" src={mediaUrl(task.media.url)} />}</div>}
            {task.passage_html && <div className="mt-5 whitespace-pre-wrap rounded-2xl border border-line bg-surface p-4 text-sm leading-7 text-ink">{task.passage_html}</div>}
            <div className="mt-5 space-y-3">{task.questions.map((item, index) => <article key={item.id} className="rounded-2xl border border-line p-4">
              <p className="font-bold leading-7 text-ink">{index + 1}. {item.prompt}</p>
              {manualTypes.has(task.type) ? <textarea disabled className="mt-3 min-h-40 w-full rounded-xl border border-line bg-surface p-3" placeholder="Student writes here…" />
                : (binaryTypes.has(task.type) ? (task.type === "true_false_not_given" ? ["True", "False", "Not Given"] : ["True", "False"]) : item.options).length > 0
                  ? <div className="mt-3 flex flex-wrap gap-2">{(binaryTypes.has(task.type) ? (task.type === "true_false_not_given" ? ["True", "False", "Not Given"] : ["True", "False"]) : item.options).map((option) => <span key={option} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink">{option}</span>)}</div>
                  : <div className="mt-3 h-10 rounded-xl border border-line bg-surface" />}
            </article>)}</div>
          </section> : <p className="text-sm text-muted">Select a task to preview it.</p>}
        </div> : <div className="mx-auto max-w-5xl space-y-5">
          {section && <div className="rounded-2xl border border-line bg-canvas p-5"><div className="flex gap-2"><Input value={section.title} onChange={(event) => updateSection({ title: event.target.value })} /><Button size="icon" onClick={saveSection} aria-label="Save section"><Save className="h-4 w-4" /></Button><Button size="icon" variant="danger" onClick={removeSection} aria-label="Delete section"><Trash2 className="h-4 w-4" /></Button></div></div>}
          <div className="rounded-3xl border border-line bg-canvas p-6 shadow-sm">
            <h2 className="text-xl font-extrabold text-ink">Task editor</h2>
            {task ? <><div className="mt-5 grid gap-4">
              <label className="space-y-2 text-sm font-bold text-ink">Task title<Input value={task.title} onChange={(event) => updateTask({ title: event.target.value })} /></label>
              <QuestionTypeSelect
                type={task.type}
                interaction={task.interaction}
                onTypeChange={updateTaskType}
                onInteractionChange={(interaction) => updateTask({ interaction })}
              />
              <label className="space-y-2 text-sm font-bold text-ink">Instructions<textarea className="min-h-28 w-full rounded-xl border border-line bg-canvas p-4 text-sm outline-none focus:border-brand" value={task.instructions} onChange={(event) => updateTask({ instructions: event.target.value })} /></label>
              <label className="space-y-2 text-sm font-bold text-ink">Reading passage / context<textarea className="min-h-28 w-full rounded-xl border border-line bg-canvas p-4 text-sm outline-none focus:border-brand" value={task.passage_html ?? ""} onChange={(event) => updateTask({ passage_html: event.target.value })} /></label>
              {task.media && <div className="rounded-2xl bg-surface p-4"><p className="flex items-center gap-2 text-sm font-bold text-ink"><Headphones className="h-4 w-4 text-brand" /> {task.media.file_name}</p>{task.media.mime_type?.startsWith("video/") ? <video controls className="mt-3 max-h-72 w-full" src={mediaUrl(task.media.url)} /> : <audio controls className="mt-3 w-full" src={mediaUrl(task.media.url)} />}</div>}
              <div className="flex gap-2"><Button onClick={saveTask}><Save className="h-4 w-4" /> Save Task</Button><Button variant="danger" onClick={removeTask}><Trash2 className="h-4 w-4" /> Delete Task</Button></div>
            </div><div className="mt-8 border-t border-line pt-6"><div className="flex items-center justify-between"><h3 className="font-extrabold text-ink">Questions</h3><Button size="sm" variant="secondary" onClick={addQuestion}><Plus className="h-4 w-4" /> Add question</Button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{task.questions.map((item, index) => <button key={item.id} onClick={() => setQuestionId(item.id)} className={`rounded-xl border p-3 text-left text-xs font-bold ${questionId === item.id ? "border-brand bg-indigo-500/5 text-brand" : "border-line text-ink"}`}>{index + 1}. {item.prompt.slice(0, 70)}</button>)}</div></div></> : <p className="mt-5 text-sm text-muted">Select or add a task.</p>}
          </div>
        </div>}
      </main>
      {!preview && <aside className="max-h-[calc(100vh-130px)] overflow-auto border-l border-line bg-canvas p-5">
        <h3 className="text-sm font-extrabold text-ink">Question & answer</h3>
        {question ? <div className="mt-5 space-y-4">
          <QuestionFields type={task?.type ?? ""} question={question} onChange={updateQuestion} />
          <div className="grid grid-cols-[1fr_auto] gap-2"><Button onClick={saveQuestion}><Check className="h-4 w-4" /> Save Question</Button><Button size="icon" variant="danger" onClick={removeQuestion} aria-label="Delete question"><Trash2 className="h-4 w-4" /></Button></div>
        </div> : <p className="mt-5 text-sm text-muted">Select or add a question.</p>}
      </aside>}
    </div>
  </div>;
}
