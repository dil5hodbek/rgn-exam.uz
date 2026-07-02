"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bookmark, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, GripVertical,
  Headphones, Lock, RotateCcw, Send, X, XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, mediaUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

type AnswerValue = string | string[] | Record<string, string> | null;
type Media = { url: string; mime_type: string; file_name: string };
type ApiQuestion = {
  id: string; prompt: string; options: Array<string | { value: string; label: string }>; points: number;
  is_example: boolean; order_index?: number;
};
type ApiTask = {
  id: string; type: string; title: string; instructions: string;
  passage_html?: string; media?: Media; questions: ApiQuestion[];
  audio_replay_limit?: number | null;
  interaction?: {
    kind?: "word_bank" | "matching" | "matching_headings" | "inline_alternatives" | "ordering" | "cloze_passage"
      | "binary_choice" | "multiple_choice" | "guided_input" | "correction"
      | "short_answer" | "long_text" | "rich_text";
    options?: string[] | { value: string; label: string }[];
    reuse_options?: boolean;
    template?: string;
    example_values?: Record<string, string>;
    items?: Array<{ number: number; before: string; options: string[]; after: string }>;
    min_words?: number | null;
    max_words?: number | null;
    manual_review?: boolean;
  };
};
type ApiSection = { id: string; title: string; tasks: ApiTask[] };
type TestDetail = {
  id: string; title: string; instructions: string;
  time_limit_minutes: number; sections: ApiSection[];
};
type Exercise = ApiTask & { section: ApiSection };
type AttemptState = {
  id: string; elapsed_seconds: number;
  answers: { question_id: string; answer: AnswerValue; flagged: boolean }[];
  checked_task_ids?: string[];
};
type ExerciseResult = Record<string, boolean | null>;

function hasAnswer(value: AnswerValue | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function textAnswer(value: AnswerValue | undefined) {
  return typeof value === "string" ? value : "";
}

function answerChoices(exercise: Exercise, question: ApiQuestion) {
  const context = `${exercise.type} ${exercise.instructions}`.toLowerCase();
  if (context.includes("true_false_not_given") || /true.+false.+not given/.test(context)) {
    return ["True", "False", "Not Given"];
  }
  if (context.includes("true_false") || /true.+false|true\s*\(t\).+false\s*\(f\)/.test(context)) {
    return ["True", "False"];
  }

  let choices = (question.options ?? [])
    .map((option) => (typeof option === "string" ? option : option.label).replace(/\s*\|\s*$/, "").trim())
    .filter(Boolean);
  if (choices.length === 1 && /\s+[b-d]\s+/i.test(choices[0])) {
    choices = choices[0].split(/\s+[b-d]\s+/i).map((option) => option.trim()).filter(Boolean);
  }
  if (!choices.length && /choose (?:the )?correct alternative/i.test(exercise.instructions)) {
    const alternative = question.prompt.match(/([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)/u);
    if (alternative) choices = [alternative[1], alternative[2]];
  }
  return choices;
}

function interactionOptions(exercise: Exercise) {
  const options = exercise.interaction?.options ?? [];
  return options.map((option) => typeof option === "string"
    ? { value: option, label: option }
    : option);
}

function inlineAlternative(question: ApiQuestion) {
  const parsedOptions = question.options
    .map((option) => typeof option === "string" ? option : option.label)
    .filter(Boolean);
  if (parsedOptions.length === 2 && question.prompt.includes("/")) {
    const slash = question.prompt.indexOf("/");
    const leftStart = question.prompt.lastIndexOf(parsedOptions[0], slash);
    const rightStart = question.prompt.indexOf(parsedOptions[1], slash);
    if (leftStart >= 0 && rightStart >= 0) {
      return {
        before: question.prompt.slice(0, leftStart),
        first: parsedOptions[0],
        second: parsedOptions[1],
        after: question.prompt.slice(rightStart + parsedOptions[1].length),
      };
    }
  }
  const match = question.prompt.match(/^(.*?)([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)(.*)$/u);
  if (!match) return null;
  return { before: match[1], first: match[2], second: match[3], after: match[4] };
}

function orderingTokens(question: ApiQuestion) {
  if (question.options?.length) return question.options.map((option) =>
    typeof option === "string" ? option : option.label
  );
  const bracketed = [...question.prompt.matchAll(/\(([^)]+)\)/g)];
  const source = bracketed.at(-1)?.[1] ?? "";
  return source.split(/\s*\/\s*|\s*,\s*/).map((token) => token.trim()).filter(Boolean);
}

function scorableQuestions(questions: ApiQuestion[]) {
  return questions.filter((question) => !question.is_example);
}

export function ExamRunner({ testId, resultBasePath }: { testId: string; resultBasePath: string }) {
  const [test, setTest] = useState<TestDetail | null>(null);
  const [attemptId, setAttemptId] = useState("");
  const [currentExercise, setCurrentExercise] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [timerStarted, setTimerStarted] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [exerciseResults, setExerciseResults] = useState<ExerciseResult>({});
  const [checkedTaskIds, setCheckedTaskIds] = useState<string[]>([]);
  const [checkingExercise, setCheckingExercise] = useState(false);
  const [mediaPlays, setMediaPlays] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const router = useRouter();

  const exercises = useMemo<Exercise[]>(
    () => test?.sections.flatMap((section) => section.tasks.map((task) => ({ ...task, section }))) ?? [],
    [test],
  );
  const questions = useMemo(
    () => exercises.flatMap((exercise) => exercise.questions),
    [exercises],
  );
  // Numbering always restarts at 1 within each exercise — never a running
  // total across the whole test — matching how the backend numbers questions.
  const questionNumbers = useMemo(() => {
    const map = new Map<string, number>();
    exercises.forEach((exercise) => {
      exercise.questions.forEach((question, index) => map.set(question.id, index + 1));
    });
    return map;
  }, [exercises]);

  useEffect(() => {
    Promise.all([
      api<TestDetail>(`/tests/${testId}`),
      api<AttemptState>(`/tests/${testId}/attempts`, { method: "POST" }),
    ]).then(([detail, attempt]) => {
      setTest(detail);
      setAttemptId(attempt.id);
      setAnswers(Object.fromEntries((attempt.answers ?? []).map((row) => [row.question_id, row.answer])));
      setFlagged((attempt.answers ?? []).filter((row) => row.flagged).map((row) => row.question_id));
      setCheckedTaskIds(attempt.checked_task_ids ?? []);
      setSeconds(Math.max(0, detail.time_limit_minutes * 60 - (attempt.elapsed_seconds ?? 0)));
      setTimerStarted(true);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load this test."));
  }, [testId]);

  useEffect(() => {
    if (!timerStarted || seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds, timerStarted]);

  useEffect(() => {
    if (timerStarted && seconds === 0) setShowReview(true);
  }, [seconds, timerStarted]);

  async function saveAnswers() {
    if (!attemptId) return;
    const ids = [...new Set([...Object.keys(answers), ...flagged])];
    if (!ids.length) return;
    setSaveState("saving");
    await api(`/attempts/${attemptId}/answers`, {
      method: "PATCH",
      body: JSON.stringify({
        answers: ids.map((question_id) => ({
          question_id,
          answer: answers[question_id] ?? null,
          flagged: flagged.includes(question_id),
        })),
      }),
    });
    setSaveState("saved");
  }

  useEffect(() => {
    if (!attemptId || (!Object.keys(answers).length && !flagged.length)) return;
    const timer = window.setTimeout(() => {
      saveAnswers().catch(() => setSaveState("idle"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [answers, flagged, attemptId]);

  async function submit() {
    if (!attemptId) return;
    try {
      await saveAnswers();
      await api(`/attempts/${attemptId}/submit`, { method: "POST" });
      router.push(`${resultBasePath}/${attemptId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit this test.");
    }
  }

  function goToExercise(index: number) {
    if (index > 0 && !checkedTaskIds.includes(exercises[index - 1]?.id)) return;
    setCurrentExercise(index);
    setSelectedToken(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exerciseUnlocked(index: number) {
    return index === 0 || checkedTaskIds.includes(exercises[index - 1]?.id);
  }

  function guardMediaPlay(exercise: Exercise, media: HTMLMediaElement) {
    const limit = exercise.audio_replay_limit;
    if (limit && (mediaPlays[exercise.id] ?? 0) >= limit) {
      media.pause();
      setError(`This recording can only be played ${limit} time${limit === 1 ? "" : "s"}.`);
    }
  }

  function recordMediaPlay(exercise: Exercise) {
    setMediaPlays((current) => ({ ...current, [exercise.id]: (current[exercise.id] ?? 0) + 1 }));
  }

  function setAnswer(questionId: string, answer: AnswerValue) {
    const owner = exercises.find((item) => item.questions.some((question) => question.id === questionId));
    if (owner && checkedTaskIds.includes(owner.id)) return;
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setExerciseResults((current) => {
      if (!(questionId in current)) return current;
      const updated = { ...current };
      delete updated[questionId];
      return updated;
    });
  }

  async function clearExercise(exercise: Exercise) {
    if (checkedTaskIds.includes(exercise.id)) {
      try {
        await api(`/attempts/${attemptId}/tasks/${exercise.id}/check`, { method: "DELETE" });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to unlock this exercise.");
        return;
      }
    }
    setAnswers((current) => ({
      ...current,
      ...Object.fromEntries(scorableQuestions(exercise.questions).map((question) => [question.id, ""])),
    }));
    setExerciseResults((current) => {
      const updated = { ...current };
      exercise.questions.forEach((question) => delete updated[question.id]);
      return updated;
    });
    setCheckedTaskIds((current) => current.filter((id) => id !== exercise.id));
    setSelectedToken(null);
  }

  function toggleFlag(questionId: string) {
    setFlagged((current) => current.includes(questionId)
      ? current.filter((id) => id !== questionId)
      : [...current, questionId]);
  }

  async function checkExercise(exercise: Exercise) {
    if (!attemptId) return;
    const unanswered = scorableQuestions(exercise.questions).filter((question) => !hasAnswer(answers[question.id]));
    if (unanswered.length) {
      setError(`Answer all ${unanswered.length} remaining question${unanswered.length === 1 ? "" : "s"} before finishing this exercise.`);
      return;
    }
    setCheckingExercise(true);
    setError("");
    try {
      await saveAnswers();
      const result = await api<{ results: { question_id: string; is_correct: boolean | null }[] }>(
        `/attempts/${attemptId}/tasks/${exercise.id}/check`,
        { method: "POST" },
      );
      setExerciseResults((current) => ({
        ...current,
        ...Object.fromEntries(result.results.map((item) => [item.question_id, item.is_correct])),
      }));
      setCheckedTaskIds((current) => current.includes(exercise.id) ? current : [...current, exercise.id]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to check this exercise.");
    } finally {
      setCheckingExercise(false);
    }
  }

  function renderDropTarget(exercise: Exercise, question: ApiQuestion) {
    const value = textAnswer(answers[question.id]);
    const label = interactionOptions(exercise).find((option) => option.value === value)?.label ?? value;
    const result = exerciseResults[question.id];
    return <span
      role="button"
      tabIndex={0}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const token = event.dataTransfer.getData("text/plain");
        if (token) setAnswer(question.id, token);
        setSelectedToken(null);
      }}
      onClick={() => {
        if (selectedToken) {
          setAnswer(question.id, selectedToken);
          setSelectedToken(null);
        }
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && selectedToken) {
          event.preventDefault();
          setAnswer(question.id, selectedToken);
          setSelectedToken(null);
        }
      }}
      className={cn(
        "mx-1 inline-flex h-9 min-w-28 max-w-full translate-y-1 items-center justify-center gap-1 rounded-lg border-2 border-dashed px-2 text-sm font-bold align-baseline transition",
        result === true ? "border-emerald-400 bg-emerald-500/10 text-emerald-700"
          : result === false ? "border-red-400 bg-red-500/10 text-red-700"
            : value ? "border-brand bg-indigo-500/5 text-ink" : "border-line bg-surface text-muted hover:border-indigo-300",
      )}
    >
      <span className="max-w-48 truncate">{label || (selectedToken ? "Place here" : "Drop answer")}</span>
      {result === true && <CheckCircle2 className="h-4 w-4 shrink-0" />}
      {result === false && <XCircle className="h-4 w-4 shrink-0" />}
      {value && <span
        role="button"
        aria-label={`Clear answer ${questionNumbers.get(question.id)}`}
        onClick={(event) => { event.stopPropagation(); setAnswer(question.id, ""); }}
        className="rounded p-0.5 hover:bg-black/5"
      ><X className="h-3.5 w-3.5" /></span>}
    </span>;
  }

  function renderPrompt(exercise: Exercise, question: ApiQuestion) {
    if (!question.is_example && ["word_bank", "matching", "matching_headings"].includes(exercise.interaction?.kind ?? "")) {
      const parts = question.prompt.split(/_{2,}/, 2);
      return <p className="whitespace-pre-wrap text-base font-bold leading-9 text-ink sm:text-lg">
        {parts[0]}{renderDropTarget(exercise, question)}{parts.length > 1 ? parts[1] : ""}
      </p>;
    }
    const alternative = exercise.interaction?.kind === "inline_alternatives"
      ? inlineAlternative(question)
      : null;
    if (!alternative || question.is_example) {
      return <p className="whitespace-pre-wrap text-base font-bold leading-7 text-ink sm:text-lg">{question.prompt}</p>;
    }
    const selected = textAnswer(answers[question.id]);
    const result = exerciseResults[question.id];
    const optionClass = (option: string) => cn(
      "mx-1 rounded-lg border px-2.5 py-1 font-extrabold transition",
      selected !== option && "border-line bg-surface text-muted hover:border-indigo-300 hover:text-ink",
      selected === option && result === true && "border-emerald-500 bg-emerald-500 text-white",
      selected === option && result === false && "border-red-500 bg-red-500 text-white",
      selected === option && result === undefined && "border-brand bg-brand text-white",
    );
    return <p className="text-base font-bold leading-9 text-ink sm:text-lg">
      {alternative.before}
      <button type="button" onClick={() => setAnswer(question.id, alternative.first)} className={optionClass(alternative.first)}>{alternative.first}</button>
      <span className="text-muted">/</span>
      <button type="button" onClick={() => setAnswer(question.id, alternative.second)} className={optionClass(alternative.second)}>{alternative.second}</button>
      {alternative.after}
      {result === true && <CheckCircle2 className="ml-2 inline h-5 w-5 text-emerald-600" />}
      {result === false && <XCircle className="ml-2 inline h-5 w-5 text-red-600" />}
    </p>;
  }

  function renderAnswer(exercise: Exercise, question: ApiQuestion) {
    if (question.is_example) return null;
    if (["word_bank", "matching", "matching_headings"].includes(exercise.interaction?.kind ?? "")) {
      return null;
    }

    if (exercise.interaction?.kind === "inline_alternatives" && inlineAlternative(question)) {
      return null;
    }

    if (exercise.interaction?.kind === "ordering") {
      const tokens = orderingTokens(question);
      const selected = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
      const remaining = [...tokens];
      selected.forEach((token) => {
        const index = remaining.indexOf(token);
        if (index >= 0) remaining.splice(index, 1);
      });
      return <div className="mt-5 space-y-3">
        <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-500/[.025] p-3">
          {selected.length ? selected.map((token, index) => <button type="button" key={`${token}-${index}`} onClick={() => setAnswer(question.id, selected.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white">{index + 1}. {token}</button>) : <span className="text-xs font-semibold text-muted">Click words below to build the answer.</span>}
        </div>
        <div className="flex flex-wrap gap-2">{remaining.map((token, index) => <button type="button" key={`${token}-${index}`} onClick={() => setAnswer(question.id, [...selected, token])} className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm font-bold text-ink hover:border-brand hover:text-brand">{token}</button>)}</div>
        {selected.length > 0 && <button type="button" onClick={() => setAnswer(question.id, [])} className="flex items-center gap-1 text-xs font-bold text-muted hover:text-ink"><RotateCcw className="h-3 w-3" /> Reset order</button>}
      </div>;
    }

    const choices = answerChoices(exercise, question);
    const answer = answers[question.id];

    if (exercise.type === "multi_select" && choices.length) {
      const selected = Array.isArray(answer) ? answer : [];
      return <div className="mt-5 grid gap-3 sm:grid-cols-2">{choices.map((option, index) => {
        const active = selected.includes(option);
        return <button
          key={`${option}-${index}`}
          onClick={() => setAnswer(question.id, active ? selected.filter((item) => item !== option) : [...selected, option])}
          className={cn(
            "flex items-center gap-3 rounded-xl border p-3 text-left text-sm font-semibold transition",
            active ? "border-brand bg-indigo-500/5 text-ink ring-2 ring-indigo-500/10" : "border-line text-ink hover:border-indigo-300",
          )}
        ><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-extrabold", active ? "bg-brand text-white" : "bg-surface text-muted")}>{String.fromCharCode(65 + index)}</span>{option}</button>;
      })}</div>;
    }

    if (choices.length) {
      const compact = choices.length <= 3 && ["true_false", "true_false_not_given"].includes(exercise.type);
      return <div className={cn("mt-4 gap-2", compact ? "flex flex-wrap" : "grid sm:grid-cols-2")}>{choices.map((option, index) => <button
        key={`${option}-${index}`}
        onClick={() => setAnswer(question.id, option)}
        className={cn(
          "flex items-center rounded-xl border text-left text-sm font-semibold transition",
          compact ? "gap-2 px-3 py-2" : "gap-3 p-3",
          answer === option ? "border-brand bg-indigo-500/5 text-ink ring-2 ring-indigo-500/10" : "border-line text-ink hover:border-indigo-300 hover:bg-surface",
        )}
      ><span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-extrabold", answer === option ? "bg-brand text-white" : "bg-surface text-muted")}>{String.fromCharCode(65 + index)}</span>{option}</button>)}</div>;
    }

    if (["writing", "rich_text_question", "speaking_prompt_placeholder"].includes(exercise.type)) {
      const content = textAnswer(answer);
      const count = content.trim() ? content.trim().split(/\s+/).length : 0;
      const minimum = exercise.interaction?.min_words;
      const maximum = exercise.interaction?.max_words;
      return <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-700">Teacher review</span>
          <span className={cn(maximum && count > maximum ? "text-red-600" : minimum && count < minimum ? "text-amber-600" : "text-muted")}>
            {count} words{minimum || maximum ? ` · guide ${minimum ?? 0}–${maximum ?? "∞"}` : ""}
          </span>
        </div>
        <textarea
          aria-label={`Answer ${questionNumbers.get(question.id)}`}
          className="min-h-56 w-full resize-y rounded-2xl border border-line bg-canvas p-4 text-sm leading-7 outline-none focus:border-brand"
          value={content}
          onChange={(event) => setAnswer(question.id, event.target.value)}
          placeholder="Write your answer…"
        />
      </div>;
    }

    return <div className="mt-5"><Input
      aria-label={`Answer ${questionNumbers.get(question.id)}`}
      value={textAnswer(answer)}
      onChange={(event) => setAnswer(question.id, event.target.value)}
      placeholder={exercise.type === "error_correction" ? "Type the corrected word or phrase…" : "Type your answer…"}
    /></div>;
  }

  function renderClozePassage(exercise: Exercise) {
    const template = exercise.interaction?.template ?? "";
    const questionsByOrder = new Map(
      exercise.questions.map((item, index) => [String(item.order_index ?? index + 1), item]),
    );
    return <article className="rounded-2xl border border-line bg-canvas p-4 sm:p-5">
      <div className="whitespace-pre-wrap text-base font-semibold leading-10 text-ink sm:text-lg">
        {template.split(/(\{\{\d+\}\})/).map((part, index) => {
          const marker = part.match(/^\{\{(\d+)\}\}$/)?.[1];
          if (!marker) return <span key={index}>{part}</span>;
          const question = questionsByOrder.get(marker);
          if (!question) return <span key={index}>_____</span>;
          if (question.is_example) {
            const example = exercise.interaction?.example_values?.[marker] ?? "";
            return <span key={index} className="mx-1 inline-flex min-w-20 justify-center border-b-2 border-sky-400 px-1 font-extrabold text-sky-600">{example}</span>;
          }
          const result = exerciseResults[question.id];
          return <span key={index} className="mx-1 inline-flex items-center gap-1 align-baseline">
            <span className="text-xs font-extrabold text-muted">{marker}</span>
            {question.options.length > 0
              ? <span className="inline-flex flex-wrap items-center gap-1">{question.options.map((option) => {
                  const selected = textAnswer(answers[question.id]) === option;
                  return <button
                    type="button"
                    key={typeof option === "string" ? option : option.label}
                    onClick={() => setAnswer(question.id, typeof option === "string" ? option : option.label)}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-sm font-bold transition",
                      selected && result === true ? "border-emerald-500 bg-emerald-500 text-white"
                        : selected && result === false ? "border-red-500 bg-red-500 text-white"
                        : selected ? "border-brand bg-brand text-white"
                        : "border-line bg-surface text-muted hover:border-indigo-300 hover:text-ink",
                    )}
                  >{typeof option === "string" ? option : option.label}</button>;
                })}</span>
              : interactionOptions(exercise).length ? renderDropTarget(exercise, question) : <input
              aria-label={`Gap ${marker}`}
              value={textAnswer(answers[question.id])}
              onChange={(event) => setAnswer(question.id, event.target.value)}
              className={cn(
                "h-9 w-24 border-0 border-b-2 bg-transparent px-1 text-center text-base font-bold outline-none sm:w-28",
                result === true ? "border-emerald-500 text-emerald-700"
                  : result === false ? "border-red-500 text-red-700"
                  : "border-line text-ink focus:border-brand",
              )}
            />}
            {result === true && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            {result === false && <XCircle className="h-4 w-4 text-red-600" />}
          </span>;
        })}
      </div>
    </article>;
  }

  if (error && !test) return <div className="grid min-h-screen place-items-center bg-surface p-6"><div className="max-w-md rounded-3xl border border-line bg-canvas p-7 text-center"><h1 className="text-xl font-extrabold text-ink">Test unavailable</h1><p className="mt-3 text-sm text-red-600">{error}</p><Button className="mt-5" onClick={() => router.back()}>Go Back</Button></div></div>;
  if (!test || !exercises.length) return <div className="grid min-h-screen place-items-center bg-surface"><div className="text-center"><span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-brand" /><p className="mt-4 text-sm font-bold text-muted">Preparing your test…</p></div></div>;

  const exercise = exercises[Math.min(currentExercise, exercises.length - 1)];
  const scoredQuestions = scorableQuestions(questions);
  const exerciseQuestions = scorableQuestions(exercise.questions);
  const answered = scoredQuestions.filter((question) => hasAnswer(answers[question.id])).length;
  const exerciseAnswered = exerciseQuestions.filter((question) => hasAnswer(answers[question.id])).length;
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const bankOptions = interactionOptions(exercise);
  const reusableOptions = exercise.interaction?.reuse_options ?? true;
  const exampleText = exercise.questions.filter((question) => question.is_example).map((question) => question.prompt.toLocaleLowerCase()).join(" ");
  const usedOptions = new Set([
    ...exercise.questions.map((question) => textAnswer(answers[question.id])).filter(Boolean),
    ...bankOptions.filter((option) => exampleText.includes(option.label.toLocaleLowerCase())).map((option) => option.value),
  ]);

  if (showReview) return <div className="min-h-screen bg-surface p-4 sm:p-8"><div className="mx-auto max-w-5xl rounded-3xl border border-line bg-canvas p-6 shadow-soft sm:p-9">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"><Check /></span>
    <h1 className="mt-6 text-3xl font-extrabold text-ink">Ready to submit?</h1>
    <p className="mt-3 text-muted">{answered} of {scoredQuestions.length} questions answered. Open an exercise to review it.</p>
    <div className="mt-7 space-y-5">{test.sections.map((section) => {
      const sectionExercises = exercises.map((item, index) => ({ item, index })).filter(({ item }) => item.section.id === section.id);
      return <section key={section.id}><h2 className="text-sm font-extrabold text-ink">{section.title}</h2><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{sectionExercises.map(({ item, index }) => {
        const itemQuestions = scorableQuestions(item.questions);
        const done = itemQuestions.filter((question) => hasAnswer(answers[question.id])).length;
        const unlocked = exerciseUnlocked(index);
        return <button key={item.id} disabled={!unlocked} onClick={() => { goToExercise(index); setShowReview(false); }} className={cn("rounded-xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-45", done === itemQuestions.length ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10" : "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-500/10")}><span className="flex items-center gap-2 text-sm font-extrabold">{!unlocked && <Lock className="h-3.5 w-3.5" />}{item.title}</span><span className="mt-1 block text-xs">{done}/{itemQuestions.length} answered</span></button>;
      })}</div></section>;
    })}</div>
    {error && <p className="mt-5 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setShowReview(false)}>Return to Test</Button><Button onClick={submit}><Send className="h-4 w-4" /> Submit Test</Button></div>
  </div></div>;

  return <div className="min-h-screen bg-surface lg:h-screen lg:overflow-hidden">
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="flex h-16 w-full items-center justify-between px-4 lg:px-6">
        <div><p className="text-xs font-bold text-brand">{exercise.section.title} · {exercise.title}</p><p className="max-w-[200px] truncate text-sm font-extrabold text-ink sm:max-w-none">{test.title}</p></div>
        <div className="flex items-center gap-3"><span className="hidden text-xs font-semibold text-muted sm:block">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "All answers saved" : "Autosave enabled"}</span><span className={cn("flex items-center gap-2 rounded-xl bg-surface px-3 py-2 font-mono text-sm font-bold", seconds < 300 ? "text-red-500" : "text-ink")}><Clock3 className="h-4 w-4 text-brand" />{time}</span></div>
      </div>
      <div className="h-1 bg-surface"><div className="h-full bg-brand transition-all" style={{ width: `${scoredQuestions.length ? (answered / scoredQuestions.length) * 100 : 0}%` }} /></div>
    </header>

    <div className="grid w-full gap-4 p-3 lg:h-[calc(100vh-65px)] lg:grid-cols-[240px_minmax(0,1fr)] lg:p-4">
      <aside className="hidden h-full overflow-auto rounded-2xl border border-line bg-canvas p-3 lg:block">
        <p className="px-2 text-xs font-bold uppercase tracking-wider text-muted">Exercises</p>
        {test.sections.map((section) => {
          const sectionExercises = exercises.map((item, index) => ({ item, index })).filter(({ item }) => item.section.id === section.id);
          const sectionQuestions = scorableQuestions(sectionExercises.flatMap(({ item }) => item.questions));
          return <div key={section.id} className="mt-4"><div className="flex items-center justify-between px-2"><p className="text-sm font-extrabold text-ink">{section.title}</p><span className="text-[11px] font-bold text-muted">{sectionQuestions.filter((question) => hasAnswer(answers[question.id])).length}/{sectionQuestions.length}</span></div><div className="mt-2 space-y-1">{sectionExercises.map(({ item, index }) => {
            const itemQuestions = scorableQuestions(item.questions);
            const done = itemQuestions.filter((question) => hasAnswer(answers[question.id])).length;
            const unlocked = exerciseUnlocked(index);
            return <button key={item.id} disabled={!unlocked} onClick={() => goToExercise(index)} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40", index === currentExercise ? "bg-brand text-white shadow-md shadow-indigo-500/20" : "bg-surface text-ink hover:bg-indigo-500/5")}><span className="flex min-w-0 items-center gap-2 truncate pr-2">{!unlocked && <Lock className="h-3 w-3 shrink-0" />}{item.title}</span><span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px]", index === currentExercise ? "bg-white/15 text-white" : done === itemQuestions.length ? "bg-emerald-500/10 text-emerald-600" : "text-muted")}>{done}/{itemQuestions.length}</span></button>;
          })}</div></div>;
        })}
      </aside>

      <main className="min-w-0 lg:flex lg:h-full lg:flex-col lg:overflow-hidden">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-2 lg:hidden">{exercises.map((item, index) => { const unlocked = exerciseUnlocked(index); return <button key={item.id} disabled={!unlocked} onClick={() => goToExercise(index)} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40", index === currentExercise ? "bg-brand text-white" : "border border-line bg-canvas text-muted")}>{!unlocked && <Lock className="h-3 w-3" />}{item.title}</button>; })}</div>

        {exercise.media && <div className="mb-3 shrink-0 rounded-2xl border border-line bg-canvas p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/10 text-indigo-500"><Headphones className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><p className="text-[10px] font-bold text-muted">{exercise.media.mime_type.startsWith("video/") ? "Listening video" : "Listening audio"}</p><p className="truncate text-xs font-extrabold text-ink">{exercise.media.file_name}</p></div>
            {exercise.audio_replay_limit && <span className="rounded-lg bg-surface px-2 py-1 text-[10px] font-bold text-muted">{Math.max(0, exercise.audio_replay_limit - (mediaPlays[exercise.id] ?? 0))} plays left</span>}
          </div>
          {exercise.media.mime_type.startsWith("video/")
            ? <video className="max-h-48 w-full rounded-xl bg-black" controls preload="metadata" src={mediaUrl(exercise.media.url)} onPlay={(event) => guardMediaPlay(exercise, event.currentTarget)} onEnded={() => recordMediaPlay(exercise)} />
            : <audio className="h-10 w-full" controls preload="metadata" src={mediaUrl(exercise.media.url)} onPlay={(event) => guardMediaPlay(exercise, event.currentTarget)} onEnded={() => recordMediaPlay(exercise)} />}
        </div>}
        {exercise.passage_html && <div className="mb-4 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-5 text-sm leading-7 text-ink">{exercise.passage_html}</div>}

        <section className="min-h-0 rounded-3xl border border-line bg-canvas p-4 shadow-sm sm:p-5 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden">
          <div className="flex shrink-0 flex-col justify-between gap-3 border-b border-line pb-4 sm:flex-row sm:items-start">
            <div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand">Exercise {currentExercise + 1} of {exercises.length}</p><h1 className="mt-2 text-2xl font-extrabold text-ink">{exercise.title}</h1><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{exercise.instructions}</p></div>
            <span className="shrink-0 rounded-xl bg-surface px-3 py-2 text-xs font-bold text-muted">{exerciseAnswered}/{exerciseQuestions.length} answered</span>
          </div>

          <div className={cn("mt-4 min-h-0 gap-4 lg:flex-1 lg:overflow-y-auto lg:pr-2", bankOptions.length && "grid lg:grid-cols-[minmax(0,1fr)_210px]")}>
            <div className="space-y-3">{exercise.interaction?.kind === "cloze_passage" ? renderClozePassage(exercise) : exercise.questions.map((question) => {
              const number = questionNumbers.get(question.id);
              const result = exerciseResults[question.id];
              const checked = question.id in exerciseResults;
              return <article key={question.id} className={cn(
                "rounded-2xl border p-4 transition",
                result === true ? "border-emerald-300 bg-emerald-500/[.04]"
                  : result === false ? "border-red-300 bg-red-500/[.04]"
                    : checked ? "border-amber-300 bg-amber-500/[.04]"
                    : hasAnswer(answers[question.id]) ? "border-indigo-200 bg-indigo-500/[.025]" : "border-line bg-canvas",
              )}>
              <div className="flex items-start gap-3">
                <span className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold",
                  result === true ? "bg-emerald-500 text-white" : result === false ? "bg-red-500 text-white"
                    : checked ? "bg-amber-500 text-white"
                    : hasAnswer(answers[question.id]) ? "bg-brand text-white" : "bg-surface text-muted",
                )}>{result === true ? <CheckCircle2 className="h-5 w-5" /> : result === false ? <XCircle className="h-5 w-5" /> : checked ? <Clock3 className="h-5 w-5" /> : number}</span>
                <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3">{renderPrompt(exercise, question)}<button aria-label={`Flag question ${number}`} onClick={() => toggleFlag(question.id)} className={cn("shrink-0 rounded-lg p-2", flagged.includes(question.id) ? "bg-orange-500/10 text-orange-600" : "bg-surface text-muted")}><Bookmark className="h-4 w-4" /></button></div>{question.is_example && <p className="mt-2 inline-flex rounded-full bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-600">Example · answer shown · not scored</p>}{renderAnswer(exercise, question)}{checked && result === null && <p className="mt-3 text-xs font-bold text-amber-600">This answer needs teacher review.</p>}</div>
              </div>
            </article>;
          })}</div>

            {bankOptions.length > 0 && <aside className="order-first mb-5 rounded-2xl border border-indigo-200 bg-indigo-500/[.035] p-4 lg:order-none lg:sticky lg:top-24 lg:mb-0 lg:self-start">
              <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-brand">{exercise.interaction?.kind === "matching" ? "Speakers" : "Word bank"}</p><p className="mt-1 text-[11px] leading-4 text-muted">{reusableOptions ? "Answers can be reused." : "Each word can be used once."}</p></div><GripVertical className="h-5 w-5 text-indigo-300" /></div>
              <div className="mt-4 flex flex-wrap gap-2 lg:flex-col">{bankOptions.map((option) => {
                const used = !reusableOptions && usedOptions.has(option.value);
                const selected = selectedToken === option.value;
                return <button
                  type="button"
                  key={option.value}
                  draggable={!used}
                  disabled={used}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", option.value);
                    setSelectedToken(option.value);
                  }}
                  onClick={() => setSelectedToken(selected ? null : option.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border bg-canvas px-3 py-2 text-left text-sm font-bold transition",
                    selected ? "border-brand text-brand ring-2 ring-indigo-500/10" : "border-line text-ink hover:border-indigo-300",
                    used && "cursor-not-allowed text-muted line-through opacity-45",
                  )}
                ><GripVertical className="h-3.5 w-3.5 shrink-0 text-muted" /><span>{option.label}</span></button>;
              })}</div>
              {selectedToken && <p className="mt-3 rounded-lg bg-brand px-3 py-2 text-[11px] font-bold text-white">Selected: {bankOptions.find((option) => option.value === selectedToken)?.label}. Now click an answer box.</p>}
              <button type="button" onClick={() => {
                setAnswers((current) => ({
                  ...current,
                  ...Object.fromEntries(exerciseQuestions.map((question) => [question.id, ""])),
                }));
                setExerciseResults((current) => {
                  const updated = { ...current };
                  exerciseQuestions.forEach((question) => delete updated[question.id]);
                  return updated;
                });
                setSelectedToken(null);
              }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-muted hover:bg-canvas hover:text-ink"><RotateCcw className="h-3.5 w-3.5" /> Clear exercise</button>
            </aside>}
          </div>

          {error && <p className="mt-5 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
          <div className="mt-4 flex shrink-0 flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" disabled={currentExercise === 0} onClick={() => goToExercise(currentExercise - 1)}><ChevronLeft className="h-4 w-4" /> Previous Exercise</Button>
            <Button variant="secondary" onClick={() => checkExercise(exercise)} disabled={checkingExercise}><Check className="h-4 w-4" /> {checkingExercise ? "Checking…" : "Finish Exercise"}</Button>
            {currentExercise < exercises.length - 1
              ? <Button disabled={!checkedTaskIds.includes(exercise.id)} onClick={() => goToExercise(currentExercise + 1)}>Next Exercise {!checkedTaskIds.includes(exercise.id) && <Lock className="h-3.5 w-3.5" />}<ChevronRight className="h-4 w-4" /></Button>
              : <Button disabled={!checkedTaskIds.includes(exercise.id)} onClick={() => setShowReview(true)}>Review & Submit {!checkedTaskIds.includes(exercise.id) && <Lock className="h-3.5 w-3.5" />}<ChevronRight className="h-4 w-4" /></Button>}
          </div>
        </section>
      </main>
    </div>
  </div>;
}
