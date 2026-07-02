"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, ChevronRight, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuestionFields, type EditableQuestion } from "@/components/admin/question-editor/QuestionFields";
import { QuestionTypeSelect, type Interaction } from "@/components/admin/question-editor/QuestionTypeSelect";
import { api } from "@/lib/api";

type DraftQuestion = EditableQuestion & { ref: string; number: number };
type DraftExercise = {
  ref: string; exercise_number: number; title: string; instructions: string;
  question_type: string | null; suggested_type: string; confidence: number;
  needs_review: boolean; reasons: string[]; interaction: Interaction;
  questions: DraftQuestion[];
};
type DraftSection = { title: string; exercises: DraftExercise[] };
type DraftTest = {
  level: string; exam_type: string; variant: number; title: string;
  source_document: string; sections: DraftSection[];
};
type ImportResult = {
  summary: { tests: number; exercises: number; questions: number; needs_review: number };
  tests: DraftTest[];
};
type Job = {
  id: string; file_name: string; status: string; progress: number;
  warnings: string[];
  result: ImportResult | { candidates?: unknown[] } | Record<string, never>;
};

function isCurrentResult(result: Job["result"]): result is ImportResult {
  return !!result && Array.isArray((result as ImportResult).tests);
}

function countNeedsReview(tests: DraftTest[]) {
  return tests.reduce((total, test) => total + test.sections.reduce((sectionTotal, section) =>
    sectionTotal + section.exercises.filter((exercise) => exercise.needs_review).length, 0), 0);
}

function mapExercises(tests: DraftTest[], fn: (exercise: DraftExercise) => DraftExercise): DraftTest[] {
  return tests.map((test) => ({
    ...test,
    sections: test.sections.map((section) => ({ ...section, exercises: section.exercises.map(fn) })),
  }));
}

export default function ImportPreview({ params }: { params: { jobId: string } }) {
  const [job, setJob] = useState<Job | null>(null);
  const [tests, setTests] = useState<DraftTest[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reviewOnly, setReviewOnly] = useState(false);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let timer: number;
    const load = async () => {
      try {
        const value = await api<Job>(`/admin/imports/${params.jobId}`);
        setJob(value);
        if (isCurrentResult(value.result)) setTests(value.result.tests);
        if (["QUEUED", "PROCESSING"].includes(value.status)) timer = window.setTimeout(load, 2000);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load import."); }
    };
    load(); return () => window.clearTimeout(timer);
  }, [params.jobId]);

  const needsReviewCount = useMemo(() => countNeedsReview(tests), [tests]);

  function notify(text: string) { setError(""); setMessage(text); }
  function fail(reason: unknown, fallback: string) { setMessage(""); setError(reason instanceof Error ? reason.message : fallback); }

  function toggleExpanded(ref: string) {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });
  }

  function patchLocalExercise(ref: string, changes: Partial<DraftExercise>) {
    setTests((current) => mapExercises(current, (exercise) => exercise.ref === ref ? { ...exercise, ...changes } : exercise));
  }

  function patchLocalQuestion(exerciseRef: string, questionRef: string, changes: Partial<DraftQuestion>) {
    setTests((current) => mapExercises(current, (exercise) => exercise.ref !== exerciseRef ? exercise : {
      ...exercise,
      questions: exercise.questions.map((question) => question.ref === questionRef ? { ...question, ...changes } : question),
    }));
  }

  async function saveExercise(exercise: DraftExercise) {
    setBusyRef(exercise.ref);
    try {
      await api(`/admin/imports/${params.jobId}/exercises/${exercise.ref}`, {
        method: "PATCH",
        body: JSON.stringify({
          question_type: exercise.question_type, interaction: exercise.interaction,
          instructions: exercise.instructions,
        }),
      });
      await Promise.all(exercise.questions.map((question) => api(
        `/admin/imports/${params.jobId}/exercises/${exercise.ref}/questions/${question.number}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            prompt: question.prompt, options: question.options, correct_answer: question.correct_answer,
            accepted_answers: question.accepted_answers, is_example: question.is_example,
          }),
        },
      )));
      patchLocalExercise(exercise.ref, { needs_review: false, confidence: 1, reasons: ["Manually set by admin."] });
      notify(`Exercise ${exercise.exercise_number} saved.`);
    } catch (reason) { fail(reason, "Unable to save this exercise."); }
    finally { setBusyRef(null); }
  }

  async function reclassifyExercise(ref: string) {
    setBusyRef(ref);
    try {
      const updated = await api<DraftExercise>(`/admin/imports/${params.jobId}/exercises/${ref}/reclassify`, { method: "POST" });
      patchLocalExercise(ref, updated);
      notify("Re-classified from the current instructions.");
    } catch (reason) { fail(reason, "Unable to reclassify this exercise."); }
    finally { setBusyRef(null); }
  }

  async function autoApproveHighConfidence() {
    const candidates = tests.flatMap((test) => test.sections.flatMap((section) => section.exercises))
      .filter((exercise) => exercise.needs_review && exercise.confidence >= 0.8 && exercise.question_type);
    if (!candidates.length) { notify("Nothing to auto-approve."); return; }
    setCommitting(true);
    try {
      await Promise.all(candidates.map((exercise) => api(`/admin/imports/${params.jobId}/exercises/${exercise.ref}`, {
        method: "PATCH", body: JSON.stringify({ question_type: exercise.question_type }),
      })));
      setTests((current) => mapExercises(current, (exercise) =>
        candidates.some((item) => item.ref === exercise.ref)
          ? { ...exercise, needs_review: false, confidence: 1, reasons: ["Manually set by admin."] }
          : exercise));
      notify(`Approved ${candidates.length} exercise(s) with ≥80% confidence.`);
    } catch (reason) { fail(reason, "Unable to auto-approve."); }
    finally { setCommitting(false); }
  }

  async function commitImport() {
    if (needsReviewCount > 0 && !window.confirm(
      `${needsReviewCount} exercise(s) still need review. Commit and publish anyway? They will be saved as "Needs review".`,
    )) return;
    setCommitting(true);
    try {
      const result = await api<{ variants: { id: string; title: string }[]; skipped: string[] }>(
        `/admin/imports/${params.jobId}/commit`, { method: "POST" },
      );
      if (result.variants.length === 1) router.push(`/admin/tests/${result.variants[0].id}/edit`);
      else router.push("/admin/tests");
    } catch (reason) { fail(reason, "Unable to commit this import."); setCommitting(false); }
  }

  if (error && !job) return <div className="p-8 text-red-600">{error}</div>;
  if (!job) return <div className="grid min-h-[70vh] place-items-center"><span className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-brand" /></div>;

  if (job.result && !isCurrentResult(job.result)) {
    return <div className="mx-auto max-w-3xl p-8">
      <p className="rounded-2xl bg-orange-500/10 p-5 text-sm font-semibold text-orange-700">
        This import is outdated and can no longer be reviewed here — please re-upload the file.
      </p>
    </div>;
  }

  const summary = isCurrentResult(job.result) ? job.result.summary : undefined;

  return <div className="mx-auto max-w-6xl p-4 pb-24 sm:p-8">
    <p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Import job</p>
    <h1 className="mt-2 text-3xl font-extrabold text-ink">{job.file_name}</h1>
    <p className="mt-2 text-sm text-muted">Status: {job.status} · {job.progress}%</p>

    <div className="mt-7 grid gap-4 sm:grid-cols-4">
      {[["Tests", summary?.tests ?? 0], ["Exercises", summary?.exercises ?? 0], ["Questions", summary?.questions ?? 0], ["Needs review", needsReviewCount]].map(([label, value]) =>
        <div key={String(label)} className="rounded-2xl border border-line bg-canvas p-5">
          <FileText className="h-5 w-5 text-brand" />
          <p className="mt-4 text-2xl font-extrabold text-ink">{value}</p>
          <p className="text-xs text-muted">{label}</p>
        </div>)}
    </div>

    {job.warnings.length > 0 && <div className="mt-6 rounded-2xl bg-orange-500/10 p-5">
      <p className="flex items-center gap-2 font-bold text-orange-700"><AlertTriangle className="h-4 w-4" /> Warnings</p>
      {job.warnings.map((warning) => <p key={warning} className="mt-2 text-sm text-orange-700">{warning}</p>)}
    </div>}

    {(message || error) && <p className={`mt-4 rounded-xl p-3 text-sm font-semibold ${error ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-700"}`}>{error || message}</p>}

    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />
        Show only exercises that need review
      </label>
      <Button variant="secondary" onClick={autoApproveHighConfidence} disabled={committing}>
        <Sparkles className="h-4 w-4" /> Auto-approve ≥80% confidence
      </Button>
    </div>

    <div className="mt-6 space-y-6">
      {tests.map((test, testIndex) => {
        const visibleSections = test.sections
          .map((section) => ({ ...section, exercises: section.exercises.filter((exercise) => !reviewOnly || exercise.needs_review) }))
          .filter((section) => section.exercises.length > 0);
        if (reviewOnly && visibleSections.length === 0) return null;
        return <div key={`${test.level}-${test.exam_type}-${test.variant}-${testIndex}`} className="rounded-3xl border border-line bg-canvas p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-brand">{test.level} · {test.exam_type} · Variant {test.variant}</p>
          <h2 className="mt-1 text-xl font-extrabold text-ink">{test.title}</h2>
          <p className="mt-1 text-xs text-muted">{test.source_document}</p>
          <div className="mt-4 space-y-4">
            {visibleSections.map((section) => <div key={section.title}>
              <h3 className="text-sm font-extrabold text-ink">{section.title}</h3>
              <div className="mt-2 space-y-2">
                {section.exercises.map((exercise) => {
                  const isOpen = expanded.has(exercise.ref);
                  return <div key={exercise.ref} className="rounded-2xl border border-line bg-surface">
                    <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => toggleExpanded(exercise.ref)}>
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted" />}
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${exercise.needs_review ? "bg-orange-500/10 text-orange-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                        {exercise.needs_review ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-bold text-ink">{exercise.title}</span>
                        <span className="block text-xs text-muted">
                          {exercise.question_type ? exercise.question_type.replaceAll("_", " ") : "Not detected"} · {Math.round(exercise.confidence * 100)}% · {exercise.questions.length} questions
                        </span>
                      </span>
                    </button>
                    {exercise.reasons.length > 0 && <p className="mx-4 -mt-2 mb-3 pl-16 text-xs text-muted">{exercise.reasons.join(" ")}</p>}
                    {isOpen && <div className="space-y-5 border-t border-line p-4">
                      <label className="block space-y-2 text-xs font-bold text-muted">Instructions
                        <textarea
                          className="min-h-20 w-full rounded-xl border border-line bg-canvas p-3 text-sm text-ink"
                          value={exercise.instructions}
                          onChange={(event) => patchLocalExercise(exercise.ref, { instructions: event.target.value })}
                        />
                      </label>
                      <QuestionTypeSelect
                        type={exercise.question_type ?? exercise.suggested_type}
                        interaction={exercise.interaction}
                        onTypeChange={(type) => patchLocalExercise(exercise.ref, { question_type: type })}
                        onInteractionChange={(interaction) => patchLocalExercise(exercise.ref, { interaction })}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => saveExercise(exercise)} disabled={busyRef === exercise.ref}>
                          <Check className="h-4 w-4" /> Save exercise
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => reclassifyExercise(exercise.ref)} disabled={busyRef === exercise.ref}>
                          <Sparkles className="h-4 w-4" /> Reclassify from instructions
                        </Button>
                      </div>
                      <div className="space-y-4 border-t border-line pt-4">
                        {exercise.questions.map((question) => <div key={question.ref} className="rounded-xl border border-line bg-canvas p-3">
                          <p className="text-xs font-bold text-muted">Question {question.number}</p>
                          <div className="mt-2">
                            <QuestionFields
                              type={exercise.question_type ?? exercise.suggested_type}
                              question={question}
                              onChange={(changes) => patchLocalQuestion(exercise.ref, question.ref, changes)}
                            />
                          </div>
                        </div>)}
                      </div>
                    </div>}
                  </div>;
                })}
              </div>
            </div>)}
          </div>
        </div>;
      })}
    </div>

    <div className="fixed inset-x-0 bottom-0 border-t border-line bg-canvas/95 p-4 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p className="text-sm text-muted">{needsReviewCount > 0 ? `${needsReviewCount} exercise(s) still need review.` : "All exercises reviewed."}</p>
        <Button size="lg" onClick={commitImport} disabled={committing || tests.length === 0}>
          <Check className="h-4 w-4" /> {committing ? "Committing…" : "Commit & Publish"}
        </Button>
      </div>
    </div>
  </div>;
}
