"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft, BookOpen, Bookmark, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, GripVertical,
  Headphones, Lock, LogOut, PenLine, RotateCcw, Send, X, XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AudioPlayer } from "@/components/exam/audio-player";
import { Button } from "@/components/ui/button";
import { sanitizeHtml } from "@/lib/sanitize";
import { Input } from "@/components/ui/input";
import { api, mediaUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

type AnswerValue = string | string[] | Record<string, string> | null;
type Media = { url: string; mime_type: string; file_name: string };
type ApiQuestion = {
  id: string; prompt: string; options: Array<string | { value: string; label: string }>; points: number;
  is_example: boolean; example_answer?: AnswerValue; order_index?: number;
};
type ApiTask = {
  id: string; type: string; title: string; instructions: string;
  passage_html?: string; media?: Media; questions: ApiQuestion[];
  audio_replay_limit?: number | null;
  interaction?: {
    kind?: "word_bank" | "matching" | "matching_headings" | "inline_alternatives" | "ordering" | "cloze_passage"
      | "binary_choice" | "multiple_choice" | "guided_input" | "correction"
      | "short_answer" | "long_text" | "rich_text" | "gap_match";
    options?: string[] | { value: string; label: string }[];
    words?: string[];
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
  answers_updated_at?: string | null;
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

// Options arrange themselves by content: short choices sit side by side on
// one row, medium ones in two columns, long ones stack full-width — so the
// reading order is always natural (a, b, c…).
function choiceGridClass(choices: string[]) {
  const longest = Math.max(0, ...choices.map((choice) => choice.length));
  if (longest <= 24) {
    if (choices.length === 2) return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-2";
    if (choices.length === 3) return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-3";
    if (choices.length === 4) return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-4";
    return "grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-3";
  }
  if (longest <= 42) return "grid gap-2.5 grid-cols-1 sm:grid-cols-2";
  return "grid gap-2.5 grid-cols-1";
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

function exampleAnswerText(question: ApiQuestion) {
  const value = question.example_answer;
  if (Array.isArray(value)) return value.map(String).join(", ");
  return value == null ? "" : String(value);
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  // gap_match: the currently picked token — a word from the box OR a reply letter.
  const [gapPick, setGapPick] = useState<{ pool: "word" | "reply"; value: string } | null>(null);
  useEffect(() => { setGapPick(null); }, [currentExercise]);
  const [exerciseResults, setExerciseResults] = useState<ExerciseResult>({});
  const [checkedTaskIds, setCheckedTaskIds] = useState<string[]>([]);
  const [checkingExercise, setCheckingExercise] = useState(false);
  const [mediaPlays, setMediaPlays] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const router = useRouter();

  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarPinned = useRef(false);
  const [sidebarThumb, setSidebarThumb] = useState({ top: 0, height: 100 });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Draggable divider between the reading passage and the questions. The user
  // grabs it and drags left/right to give either side more room. Default 56%.
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingSplit = useRef(false);
  const [passageWidth, setPassageWidth] = useState(56);
  // Reading passage text size (px) — the +/− zoom buttons step it.
  const [passageZoom, setPassageZoom] = useState(15);
  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!draggingSplit.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      setPassageWidth(Math.min(75, Math.max(30, pct)));
    }
    function onUp() {
      if (!draggingSplit.current) return;
      draggingSplit.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);
  function startSplitDrag(event: ReactPointerEvent) {
    event.preventDefault();
    draggingSplit.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function updateSidebarThumb() {
    const el = sidebarScrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) { setSidebarThumb({ top: 0, height: 100 }); return; }
    const height = Math.max((clientHeight / scrollHeight) * 100, 8);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (100 - height);
    setSidebarThumb({ top, height });
  }

  function clearSidebarTimer() {
    if (sidebarTimer.current) { clearTimeout(sidebarTimer.current); sidebarTimer.current = null; }
  }

  // Open the exercises panel, then auto-collapse after `durationMs` (used on load).
  function openSidebarFor(durationMs: number) {
    sidebarPinned.current = false;
    setSidebarOpen(true);
    clearSidebarTimer();
    sidebarTimer.current = setTimeout(() => setSidebarOpen(false), durationMs);
  }

  // Hover in: keep an already-open panel from auto-collapsing while the pointer is over it.
  // Does not reopen a collapsed panel — that stays an explicit click on the handle.
  function holdSidebar() {
    if (!sidebarOpen) return;
    if (!sidebarPinned.current) clearSidebarTimer();
  }

  // Hover out: collapse shortly after leaving, unless it was pinned open via the handle.
  function releaseSidebar() {
    if (sidebarPinned.current) return;
    clearSidebarTimer();
    sidebarTimer.current = setTimeout(() => setSidebarOpen(false), 700);
  }

  // The round handle: `<` collapses the whole panel now; `>` opens it, pinned for 15s.
  function toggleSidebar() {
    clearSidebarTimer();
    if (sidebarOpen) {
      sidebarPinned.current = false;
      setSidebarOpen(false);
    } else {
      sidebarPinned.current = true;
      setSidebarOpen(true);
      requestAnimationFrame(updateSidebarThumb);
      sidebarTimer.current = setTimeout(() => { sidebarPinned.current = false; setSidebarOpen(false); }, 15000);
    }
  }

  const exercises = useMemo<Exercise[]>(
    () => test?.sections.flatMap((section) => section.tasks.map((task) => ({ ...task, section }))) ?? [],
    [test],
  );
  const questions = useMemo(
    () => exercises.flatMap((exercise) => exercise.questions),
    [exercises],
  );
  // Per-exercise panel defaults: writing/speaking briefs are short, so their
  // panel starts at the minimum width with larger text (140%); reading
  // passages get the roomier split and normal text.
  useEffect(() => {
    const active = exercises[currentExercise];
    if (!active) return;
    const manual = ["writing", "rich_text_question", "speaking_prompt_placeholder"].includes(active.type);
    setPassageWidth(manual ? 30 : 56);
    setPassageZoom(manual ? 21 : 15);
  }, [currentExercise, exercises]);

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
      const serverAnswers = Object.fromEntries((attempt.answers ?? []).map((row) => [row.question_id, row.answer]));
      let serverFlagged = (attempt.answers ?? []).filter((row) => row.flagged).map((row) => row.question_id);
      // The local backup holds whatever was on the screen at the moment of a
      // refresh — but it only wins when it is NEWER than the server copy
      // (15s clock tolerance), so an old device never overwrites newer work.
      try {
        const stored = localStorage.getItem(`exam-progress:${attempt.id}`);
        if (stored) {
          const local = JSON.parse(stored);
          const serverSavedAt = attempt.answers_updated_at ? Date.parse(attempt.answers_updated_at) : 0;
          const localSavedAt = typeof local.savedAt === "number" ? local.savedAt : Date.now();
          if (localSavedAt >= serverSavedAt - 15000) {
            Object.assign(serverAnswers, local.answers ?? {});
            if (Array.isArray(local.flagged)) serverFlagged = local.flagged;
          }
        }
      } catch { /* corrupted backup — server copy is fine */ }
      setAnswers(serverAnswers);
      setFlagged(serverFlagged);
      setCheckedTaskIds(attempt.checked_task_ids ?? []);
      // Reopen on the exercise the student left from.
      try {
        const position = Number(localStorage.getItem(`exam-position:${attempt.id}`) ?? "0");
        const total = detail.sections.flatMap((section) => section.tasks).length;
        if (Number.isFinite(position) && position > 0 && position < total) setCurrentExercise(position);
      } catch { /* start from the first exercise */ }
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

  useEffect(() => {
    if (!test) return;
    updateSidebarThumb();
    openSidebarFor(5000);
    return () => { if (sidebarTimer.current) clearTimeout(sidebarTimer.current); };
  }, [test]);

  async function saveAnswers() {
    if (!attemptId) return;
    const ids = [...new Set([...Object.keys(answers), ...flagged])];
    if (!ids.length) return;
    setSaveState("saving");
    try {
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
    } catch (reason) {
      setSaveState("error");
      throw reason;
    }
  }

  // Real-time persistence, three layers deep:
  // 1. every change lands in localStorage instantly (survives refresh/crash);
  // 2. a short debounce pushes it to the server;
  // 3. leaving/hiding the page forces one last server save.
  useEffect(() => {
    if (!attemptId) return;
    try {
      localStorage.setItem(`exam-progress:${attemptId}`, JSON.stringify({ answers, flagged, savedAt: Date.now() }));
    } catch { /* storage full — server save still runs */ }
  }, [answers, flagged, attemptId]);

  useEffect(() => {
    if (!attemptId || (!Object.keys(answers).length && !flagged.length)) return;
    const timer = window.setTimeout(() => {
      saveAnswers().catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, flagged, attemptId]);

  // Failed saves retry on their own until the network/server recovers.
  useEffect(() => {
    if (saveState !== "error") return;
    const timer = window.setTimeout(() => { saveAnswers().catch(() => {}); }, 5000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  useEffect(() => {
    if (!attemptId) return;
    const flush = () => { saveAnswers().catch(() => {}); };
    // Leaving the page (close/refresh/navigate away) freezes the timer too —
    // a keepalive request survives the unload; resuming restores the clock.
    const onLeave = () => {
      flush();
      const base = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
      try {
        fetch(`${base}/attempts/${attemptId}/pause`, {
          method: "POST", credentials: "include", keepalive: true,
        }).catch(() => {});
      } catch { /* best effort */ }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, flagged, attemptId]);

  // Remember which exercise is open so "Save & exit" resumes right here.
  useEffect(() => {
    if (!attemptId) return;
    try { localStorage.setItem(`exam-position:${attemptId}`, String(currentExercise)); } catch { /* ignore */ }
  }, [currentExercise, attemptId]);

  // "Save & exit": push every answer to the server, freeze the timer, leave.
  // Coming back resumes from the same exercise with the same time remaining.
  async function saveAndExit() {
    if (!attemptId) return;
    try {
      await saveAnswers();
      await api(`/attempts/${attemptId}/pause`, { method: "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save before exit. Check your connection.");
      return;
    }
    router.push("/dashboard");
  }

  // Wipe everything and start the test from scratch: answers, exercise locks,
  // results and the timer all reset.
  async function restartAttempt() {
    if (!attemptId || !window.confirm("Start the test over? All your answers and results will be erased.")) return;
    try {
      await api(`/attempts/${attemptId}/restart`, { method: "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to restart the test.");
      return;
    }
    try {
      localStorage.removeItem(`exam-progress:${attemptId}`);
      localStorage.removeItem(`exam-position:${attemptId}`);
    } catch { /* ignore */ }
    setAnswers({});
    setFlagged([]);
    setExerciseResults({});
    setCheckedTaskIds([]);
    setCurrentExercise(0);
    setShowReview(false);
    setError("");
    setSaveState("idle");
    if (test) setSeconds(test.time_limit_minutes * 60);
  }

  async function submit() {
    if (!attemptId) return;
    try {
      await saveAnswers();
      try {
        localStorage.removeItem(`exam-progress:${attemptId}`);
        localStorage.removeItem(`exam-position:${attemptId}`);
      } catch { /* ignore */ }
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

  // Unlock a finished exercise so the student can change their answers —
  // keeps everything they entered, only removes the "checked" lock.
  async function unlockExercise(exercise: Exercise) {
    try {
      await api(`/attempts/${attemptId}/tasks/${exercise.id}/check`, { method: "DELETE" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to unlock this exercise.");
      return;
    }
    setCheckedTaskIds((current) => current.filter((id) => id !== exercise.id));
    setExerciseResults((current) => {
      const updated = { ...current };
      exercise.questions.forEach((question) => delete updated[question.id]);
      return updated;
    });
    setError("");
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
    if (unanswered.length && !window.confirm(
      `You have ${unanswered.length} unanswered question${unanswered.length === 1 ? "" : "s"}. Are you sure you want to finish this exercise?`,
    )) return;
    setCheckingExercise(true);
    setError("");
    try {
      await saveAnswers();
      const result = await api<{ results: { question_id: string; is_correct: boolean | null; is_example?: boolean }[] }>(
        `/attempts/${attemptId}/tasks/${exercise.id}/check`,
        { method: "POST" },
      );
      // Examples are reference items — checking never marks them right/wrong.
      setExerciseResults((current) => ({
        ...current,
        ...Object.fromEntries(result.results.filter((item) => !item.is_example).map((item) => [item.question_id, item.is_correct])),
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
    if (question.is_example) {
      const example = exampleAnswerText(question);
      // Alternatives example: the correct word is highlighted, the other greyed.
      if (alternative && example) {
        const altChip = (word: string) => cn(
          "mx-1 rounded-lg border px-2.5 py-1 font-extrabold",
          word.toLocaleLowerCase() === example.toLocaleLowerCase()
            ? "border-sky-400 bg-sky-500/10 text-sky-600"
            : "border-line bg-surface text-muted/60 line-through",
        );
        return <p className="text-base font-bold leading-9 text-ink sm:text-lg">
          {alternative.before}
          <span className={altChip(alternative.first)}>{alternative.first}</span>
          <span className="text-muted">/</span>
          <span className={altChip(alternative.second)}>{alternative.second}</span>
          {alternative.after}
        </p>;
      }
      // Gap example: the model answer sits inside the blank.
      if (example && /_{2,}/.test(question.prompt)) {
        const parts = question.prompt.split(/_{2,}/);
        return <p className="whitespace-pre-wrap text-base font-bold leading-9 text-ink sm:text-lg">
          {parts[0]}
          <span className="mx-1 inline-flex min-w-16 justify-center border-b-2 border-sky-400 px-1 font-extrabold text-sky-600">{example}</span>
          {parts.slice(1).join("___")}
        </p>;
      }
      return <p className="whitespace-pre-wrap text-base font-bold leading-7 text-ink sm:text-lg">{question.prompt}</p>;
    }
    if (!alternative) {
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
    if (question.is_example) {
      const example = exampleAnswerText(question);
      if (!example) return null;
      // Already shown inside the prompt (gap or alternatives) — nothing below.
      if (/_{2,}/.test(question.prompt)) return null;
      if (exercise.interaction?.kind === "inline_alternatives" && inlineAlternative(question)) return null;
      // Matching / word bank example: show the matched option as a filled chip.
      if (["word_bank", "matching", "matching_headings"].includes(exercise.interaction?.kind ?? "")) {
        const matched = interactionOptions(exercise).find(
          (option) => option.value.toLocaleLowerCase() === example.toLocaleLowerCase(),
        );
        return <p className="mt-3 inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-500/10 px-3.5 py-2 text-sm font-bold text-sky-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {matched ? `${matched.value}) ${matched.label}` : example}
        </p>;
      }
      // Choice-based example: every option visible, the correct one marked.
      const exampleChoices = answerChoices(exercise, question);
      if (exampleChoices.length) {
        const chosen = Array.isArray(question.example_answer)
          ? question.example_answer.map((item) => String(item).toLocaleLowerCase())
          : [example.toLocaleLowerCase()];
        const compact = exampleChoices.length <= 3 && ["true_false", "true_false_not_given"].includes(exercise.type);
        return <div className={cn("mt-4", compact ? "flex flex-wrap gap-2" : choiceGridClass(exampleChoices))}>{exampleChoices.map((option, index) => {
          const correct = chosen.includes(option.toLocaleLowerCase());
          return <span key={`${option}-${index}`} className={cn(
            "flex items-center rounded-xl border-2 text-left text-sm font-semibold",
            compact ? "gap-2 px-4 py-2.5" : "gap-3 px-3.5 py-3",
            correct ? "border-sky-400 bg-sky-500/10 text-sky-700" : "border-line text-muted/60",
          )}>
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-extrabold", correct ? "border-sky-500 bg-sky-500 text-white" : "border-line bg-surface text-muted")}>
              {correct ? <Check className="h-4 w-4" /> : String.fromCharCode(97 + index)}
            </span><span className="min-w-0">{option}</span>
          </span>;
        })}</div>;
      }
      // Free-text example (short answer, error correction, …): read-only answer.
      return <p className="mt-3 inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-500/10 px-3.5 py-2 text-sm font-bold text-sky-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" /> {example}
      </p>;
    }
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
      return <div className={cn("mt-4", choiceGridClass(choices))}>{choices.map((option, index) => {
        const active = selected.includes(option);
        return <button
          key={`${option}-${index}`}
          onClick={() => setAnswer(question.id, active ? selected.filter((item) => item !== option) : [...selected, option])}
          className={cn(
            "group flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left text-sm font-semibold transition-all duration-150",
            active
              ? "border-brand bg-indigo-500/[.07] text-ink shadow-sm shadow-indigo-500/10"
              : "border-line bg-canvas text-ink hover:-translate-y-px hover:border-indigo-300 hover:shadow-sm",
          )}
        ><span className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 text-[11px] font-extrabold transition-all duration-150",
          active ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted group-hover:border-indigo-300 group-hover:text-brand",
        )}>{active ? <Check className="h-4 w-4" /> : String.fromCharCode(97 + index)}</span><span className="min-w-0">{option}</span></button>;
      })}</div>;
    }

    if (choices.length) {
      const compact = choices.length <= 3 && ["true_false", "true_false_not_given"].includes(exercise.type);
      if (compact) {
        return <div className="mt-4 flex flex-wrap gap-2">{choices.map((option) => {
          const active = answer === option;
          return <button
            key={option}
            onClick={() => setAnswer(question.id, option)}
            className={cn(
              "flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-bold transition-all duration-150",
              active
                ? "border-brand bg-brand text-white shadow-md shadow-indigo-500/25"
                : "border-line bg-canvas text-ink hover:-translate-y-px hover:border-indigo-300 hover:shadow-sm",
            )}
          >{active && <Check className="h-4 w-4" />}{option}</button>;
        })}</div>;
      }
      return <div className={cn("mt-4", choiceGridClass(choices))}>{choices.map((option, index) => {
        const active = answer === option;
        return <button
          key={`${option}-${index}`}
          onClick={() => setAnswer(question.id, option)}
          className={cn(
            "group flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left text-sm font-semibold transition-all duration-150",
            active
              ? "border-brand bg-indigo-500/[.07] text-ink shadow-sm shadow-indigo-500/10"
              : "border-line bg-canvas text-ink hover:-translate-y-px hover:border-indigo-300 hover:shadow-sm",
          )}
        ><span className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-extrabold transition-all duration-150",
          active ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted group-hover:border-indigo-300 group-hover:text-brand",
        )}>{active ? <Check className="h-4 w-4" /> : String.fromCharCode(97 + index)}</span><span className="min-w-0">{option}</span></button>;
      })}</div>;
    }

    if (["writing", "rich_text_question", "speaking_prompt_placeholder"].includes(exercise.type)) {
      const content = textAnswer(answer);
      const count = content.trim() ? content.trim().split(/\s+/).length : 0;
      const minimum = exercise.interaction?.min_words;
      const maximum = exercise.interaction?.max_words;
      const inRange = (!minimum || count >= minimum) && (!maximum || count <= maximum);
      return <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
          <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-brand">🤖 AI graded</span>
          <span className={cn(
            "rounded-full px-3 py-1 transition-colors",
            count === 0 ? "bg-surface text-muted"
              : maximum && count > maximum ? "bg-red-500/10 text-red-600"
              : !inRange ? "bg-amber-500/10 text-amber-600"
              : "bg-emerald-500/10 text-emerald-600",
          )}>
            {count} words{minimum || maximum ? ` · guide ${minimum ?? 0}–${maximum ?? "∞"}` : ""}{count > 0 && inRange ? " ✓" : ""}
          </span>
        </div>
        {/* The writing sheet fills the rest of the screen — a full page, not a small box. */}
        <textarea
          aria-label={`Answer ${questionNumbers.get(question.id)}`}
          className="min-h-[52vh] w-full resize-y rounded-2xl border border-line bg-canvas p-5 text-[15px] leading-8 outline-none transition focus:border-brand focus:ring-4 focus:ring-indigo-500/10"
          value={content}
          onChange={(event) => setAnswer(question.id, event.target.value)}
          placeholder="Write your answer…"
        />
      </div>;
    }

    if (exercise.type === "error_correction") {
      return <div className="mt-5"><Input
        aria-label={`Answer ${questionNumbers.get(question.id)}`}
        value={textAnswer(answer)}
        onChange={(event) => setAnswer(question.id, event.target.value)}
        placeholder="Rewrite the correct sentence…"
      /></div>;
    }
    return <div className="mt-5"><Input
      aria-label={`Answer ${questionNumbers.get(question.id)}`}
      value={textAnswer(answer)}
      onChange={(event) => setAnswer(question.id, event.target.value)}
      placeholder="Type your answer…"
    /></div>;
  }

  // Two-part coursebook exercise: word box (left) fills the gaps, replies
  // (right) match each completed question. Questions alternate word/reply
  // rows in the data; the UI shows them as one row per item.
  function renderGapMatch(exercise: Exercise) {
    const sorted = [...exercise.questions].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const rows: { word: ApiQuestion; reply: ApiQuestion }[] = [];
    for (let i = 0; i + 1 < sorted.length; i += 2) rows.push({ word: sorted[i], reply: sorted[i + 1] });
    const words = exercise.interaction?.words ?? [];
    const replies = interactionOptions(exercise);
    const usedWords = new Set(rows.map(({ word }) => (word.is_example ? exampleAnswerText(word) : textAnswer(answers[word.id]))).filter(Boolean));
    const usedReplies = new Set(rows.map(({ reply }) => textAnswer(answers[reply.id])).filter(Boolean));

    const slotClass = (filled: boolean, result: boolean | null | undefined, receptive: boolean) => cn(
      "inline-flex min-h-9 max-w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-2.5 py-1 text-sm font-bold align-baseline transition",
      result === true ? "border-emerald-400 bg-emerald-500/10 text-emerald-700"
        : result === false ? "border-red-400 bg-red-500/10 text-red-700"
        : filled ? "border-brand bg-indigo-500/5 text-ink"
        : receptive ? "animate-pulse border-brand bg-indigo-500/10 text-brand"
        : "border-line bg-surface text-muted hover:border-indigo-300",
    );

    function place(question: ApiQuestion, pool: "word" | "reply") {
      if (gapPick?.pool === pool) {
        setAnswer(question.id, gapPick.value);
        setGapPick(null);
      } else if (hasAnswer(answers[question.id])) {
        setAnswer(question.id, "");
      }
    }

    // Chips can be dragged with the cursor and dropped on a slot; clicking
    // (pick → place) still works everywhere, including touch screens.
    const dragProps = (pool: "word" | "reply", value: string) => ({
      draggable: true,
      onDragStart: (event: ReactDragEvent) => {
        event.dataTransfer.setData("text/plain", JSON.stringify({ pool, value }));
        event.dataTransfer.effectAllowed = "move";
        setGapPick({ pool, value });
      },
      onDragEnd: () => setGapPick(null),
    });
    const dropProps = (question: ApiQuestion, pool: "word" | "reply") => ({
      onDragOver: (event: ReactDragEvent) => { if (gapPick?.pool === pool) event.preventDefault(); },
      onDrop: (event: ReactDragEvent) => {
        event.preventDefault();
        try {
          const data = JSON.parse(event.dataTransfer.getData("text/plain"));
          if (data?.pool === pool && typeof data.value === "string") setAnswer(question.id, data.value);
        } catch { /* not one of our chips */ }
        setGapPick(null);
      },
    });

    return <div className="space-y-4 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_250px] lg:gap-4 lg:space-y-0">
      {/* Word box — left column */}
      <aside className="rounded-2xl border border-indigo-200 bg-indigo-500/[.035] p-4 lg:sticky lg:top-2 lg:col-start-1 lg:row-start-1 lg:self-start">
        <p className="text-xs font-bold uppercase tracking-wider text-brand">Word box</p>
        <p className="mt-1 text-[11px] leading-4 text-muted">Pick a word, then click a gap. Each word is used once.</p>
        <div className="mt-3 flex flex-wrap gap-2 lg:flex-col">
          {words.map((word) => {
            const used = usedWords.has(word);
            const picked = gapPick?.pool === "word" && gapPick.value === word;
            return <button key={word} type="button" disabled={used}
              {...(used ? {} : dragProps("word", word))}
              onClick={() => setGapPick(picked ? null : { pool: "word", value: word })}
              className={cn(
                "rounded-lg border-2 px-3 py-2 text-left text-sm font-bold transition",
                used ? "cursor-not-allowed border-line bg-surface text-muted/40 line-through"
                  : picked ? "cursor-grabbing border-brand bg-brand text-white shadow-md shadow-indigo-500/25"
                  : "cursor-grab border-line bg-canvas text-ink hover:border-brand hover:text-brand active:cursor-grabbing",
              )}>{word}</button>;
          })}
        </div>
      </aside>

      {/* Questions — centre column */}
      <div className="space-y-3 lg:col-start-2 lg:row-start-1">
        {rows.map(({ word, reply }, index) => {
          const parts = word.prompt.split(/_{2,}/);
          const wordResult = exerciseResults[word.id];
          const replyResult = exerciseResults[reply.id];
          const wordValue = word.is_example ? exampleAnswerText(word) : textAnswer(answers[word.id]);
          const replyValue = textAnswer(answers[reply.id]);
          const replyLabel = replies.find((option) => option.value === replyValue)?.label ?? "";
          return <article key={word.id} id={`q-${word.id}`} className="scroll-mt-4 rounded-2xl border border-line bg-canvas p-4 transition-all hover:border-indigo-200/70 sm:p-5">
            <div className="flex items-start gap-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface text-sm font-extrabold text-muted">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold leading-9 text-ink sm:text-lg">
                  {parts[0]}
                  {word.is_example
                    ? <span className="mx-1 inline-flex min-w-16 justify-center border-b-2 border-sky-400 px-1 font-extrabold text-sky-600">{wordValue}</span>
                    : <button type="button" onClick={() => place(word, "word")} {...dropProps(word, "word")} className={cn("mx-1", slotClass(!!wordValue, wordResult, gapPick?.pool === "word"))}>
                        {wordValue || "word"}
                        {wordResult === true && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                        {wordResult === false && <XCircle className="h-4 w-4 shrink-0" />}
                      </button>}
                  {parts.slice(1).join("___")}
                </p>
                <div className="mt-2.5 flex items-center gap-2" id={`q-${reply.id}`}>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Reply</span>
                  <button type="button" onClick={() => place(reply, "reply")} {...dropProps(reply, "reply")} className={slotClass(!!replyValue, replyResult, gapPick?.pool === "reply")}>
                    {replyValue
                      ? <><b className="shrink-0 text-brand">{replyValue})</b><span className="truncate">{replyLabel}</span></>
                      : "match the reply"}
                    {replyResult === true && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                    {replyResult === false && <XCircle className="h-4 w-4 shrink-0" />}
                  </button>
                </div>
                {word.is_example && <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-600"><CheckCircle2 className="h-3.5 w-3.5" /> Example word — not scored</p>}
              </div>
            </div>
          </article>;
        })}
      </div>

      {/* Replies — right column */}
      <aside className="rounded-2xl border border-indigo-200 bg-indigo-500/[.035] p-4 lg:sticky lg:top-2 lg:col-start-3 lg:row-start-1 lg:self-start">
        <p className="text-xs font-bold uppercase tracking-wider text-brand">Replies</p>
        <p className="mt-1 text-[11px] leading-4 text-muted">Pick a reply, then click “match the reply” under a question.</p>
        <div className="mt-3 space-y-2">
          {replies.map((option) => {
            const used = usedReplies.has(option.value);
            const picked = gapPick?.pool === "reply" && gapPick.value === option.value;
            return <button key={option.value} type="button" disabled={used}
              {...(used ? {} : dragProps("reply", option.value))}
              onClick={() => setGapPick(picked ? null : { pool: "reply", value: option.value })}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border-2 p-2.5 text-left text-xs font-semibold leading-5 transition",
                used ? "cursor-not-allowed border-line bg-surface text-muted/40"
                  : picked ? "cursor-grabbing border-brand bg-brand text-white shadow-md shadow-indigo-500/25"
                  : "cursor-grab border-line bg-canvas text-ink hover:border-brand active:cursor-grabbing",
              )}>
              <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded font-extrabold", picked ? "bg-white/20 text-white" : "bg-surface text-brand")}>{option.value}</span>
              <span className="min-w-0">{option.label}</span>
            </button>;
          })}
        </div>
      </aside>
    </div>;
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
            const example = exercise.interaction?.example_values?.[marker] ?? exampleAnswerText(question);
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
  // A reading text may be typed into the dedicated (rich-text) passage field OR
  // into the instructions field. Either way, treat a long block as the passage
  // so the screen splits (text ↔ questions) instead of hiding it in a header.
  const passageHtml = exercise.passage_html?.trim() || "";
  const passagePlain = !passageHtml && exercise.instructions.trim().length > 160 ? exercise.instructions.trim() : "";
  const passageText = passageHtml || passagePlain;
  // The same split panel serves two jobs: a reading text for reading
  // exercises, and the task brief for writing/speaking exercises — the label
  // and icon follow the exercise type.
  const isManualTask = ["writing", "rich_text_question", "speaking_prompt_placeholder"].includes(exercise.type);
  const PanelIcon = isManualTask ? PenLine : BookOpen;
  const panelLabel = isManualTask ? "Writing task" : "Reading passage";
  const headerInstructions = exercise.instructions.trim() && exercise.instructions.trim() !== passageText
    ? exercise.instructions : "";
  const scoredQuestions = scorableQuestions(questions);
  const exerciseQuestions = scorableQuestions(exercise.questions);
  const answered = scoredQuestions.filter((question) => hasAnswer(answers[question.id])).length;
  const exerciseAnswered = exerciseQuestions.filter((question) => hasAnswer(answers[question.id])).length;
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  // gap_match draws its own two banks (words + replies) — keep the generic
  // right-hand bank for the other interactive kinds only.
  const isGapMatch = exercise.interaction?.kind === "gap_match";
  const bankOptions = isGapMatch ? [] : interactionOptions(exercise);
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
    <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button variant="danger" onClick={restartAttempt} className="sm:mr-auto"><RotateCcw className="h-4 w-4" /> Restart Test</Button>
      <Button variant="secondary" onClick={() => setShowReview(false)}>Return to Test</Button>
      <Button onClick={submit}><Send className="h-4 w-4" /> Submit Test</Button>
    </div>
  </div></div>;

  return <div className="min-h-screen bg-surface lg:h-screen lg:overflow-hidden">
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/dashboard"))}
            aria-label="Go back"
            title="Back"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:bg-surface hover:text-ink"
          ><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0">
            <p className="max-w-[240px] truncate text-base font-extrabold text-ink sm:max-w-none sm:text-lg">{test.title}</p>
          </div>
        </div>
        <div className="flex w-full min-w-0 items-center justify-end gap-2.5 sm:w-auto">
          {exercise.media?.mime_type.startsWith("audio/") && <>
            <AudioPlayer className="w-full min-w-0 sm:w-80 sm:shrink-0" src={mediaUrl(exercise.media.url)} autoStartDelay={5000} onPlay={(media) => guardMediaPlay(exercise, media)} onEnded={() => recordMediaPlay(exercise)} />
            {exercise.audio_replay_limit && <span className="hidden shrink-0 rounded-lg bg-surface px-2 py-2 text-[10px] font-bold text-muted xl:block">{Math.max(0, exercise.audio_replay_limit - (mediaPlays[exercise.id] ?? 0))} left</span>}
          </>}
          <span className="hidden shrink-0 rounded-xl bg-surface px-2.5 py-2 text-xs font-bold text-muted sm:block">{exerciseAnswered}/{exerciseQuestions.length}</span>
          <span className={cn("hidden shrink-0 text-xs font-semibold xl:block", saveState === "error" ? "text-red-500" : "text-muted")}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "All answers saved" : saveState === "error" ? "⚠ Not saved — retrying…" : "Autosave enabled"}</span>
          <span className={cn("flex shrink-0 items-center gap-2 rounded-xl bg-surface px-3 py-2 font-mono text-sm font-bold", seconds < 300 ? "text-red-500" : "text-ink")}><Clock3 className="h-4 w-4 text-brand" />{time}</span>
          <button
            type="button"
            onClick={saveAndExit}
            title="Save everything and continue later"
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink transition hover:border-brand hover:text-brand"
          ><LogOut className="h-4 w-4" /><span className="hidden md:inline">Save & exit</span></button>
        </div>
      </div>
      <div className="h-1 bg-surface"><div className="h-full bg-brand transition-all" style={{ width: `${scoredQuestions.length ? (answered / scoredQuestions.length) * 100 : 0}%` }} /></div>
    </header>

    <div className="p-3 lg:flex lg:h-[calc(100vh-65px)] lg:gap-4 lg:p-4">
      <div
        className={cn("group/side relative hidden h-full shrink-0 lg:block", !sidebarOpen && "lg:-mr-4")}
        onMouseEnter={holdSidebar}
        onMouseLeave={releaseSidebar}
      >
      <div className={cn("h-full overflow-hidden rounded-2xl transition-[width] duration-300 ease-out", sidebarOpen ? "w-60" : "w-0")}>
        <aside
          ref={sidebarScrollRef}
          onScroll={updateSidebarThumb}
          className="no-scrollbar h-full w-60 overflow-y-auto rounded-2xl border border-line bg-canvas p-3"
        >
          <p className="px-2 text-xs font-bold uppercase tracking-wider text-muted">Exercises</p>
          {test.sections.map((section) => {
            const sectionExercises = exercises.map((item, index) => ({ item, index })).filter(({ item }) => item.section.id === section.id);
            const sectionQuestions = scorableQuestions(sectionExercises.flatMap(({ item }) => item.questions));
            return <div key={section.id} className="mt-4"><div className="flex items-center justify-between px-2"><p className="text-sm font-extrabold text-ink">{section.title}</p><span className="text-[11px] font-bold text-muted">{sectionQuestions.filter((question) => hasAnswer(answers[question.id])).length}/{sectionQuestions.length}</span></div><div className="mt-2 space-y-1">{sectionExercises.map(({ item, index }) => {
              const itemQuestions = scorableQuestions(item.questions);
              const done = itemQuestions.filter((question) => hasAnswer(answers[question.id])).length;
              const unlocked = exerciseUnlocked(index);
              return <div key={item.id}>
                <button disabled={!unlocked} onClick={() => goToExercise(index)} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40", index === currentExercise ? "bg-brand text-white shadow-md shadow-indigo-500/20" : "bg-surface text-ink hover:bg-indigo-500/5")}><span className="flex min-w-0 items-center gap-2 truncate pr-2">{!unlocked && <Lock className="h-3 w-3 shrink-0" />}{item.title}</span><span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px]", index === currentExercise ? "bg-white/15 text-white" : done === itemQuestions.length ? "bg-emerald-500/10 text-emerald-600" : "text-muted")}>{done}/{itemQuestions.length}</span></button>
                {/* Question palette: jump to any question, colour = its status. */}
                {index === currentExercise && itemQuestions.length > 0 && <div className="mb-1 mt-1.5 grid grid-cols-6 gap-1 px-0.5">
                  {itemQuestions.map((q) => {
                    const r = exerciseResults[q.id];
                    const checkedQ = q.id in exerciseResults;
                    const answeredQ = hasAnswer(answers[q.id]);
                    const isFlagged = flagged.includes(q.id);
                    return <button
                      key={q.id}
                      title={isFlagged ? "Flagged" : undefined}
                      onClick={() => document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                      className={cn("relative grid h-7 place-items-center rounded-md text-[11px] font-bold transition",
                        checkedQ && r === true ? "bg-emerald-500 text-white"
                          : checkedQ && r === false ? "bg-red-500 text-white"
                            : checkedQ ? "bg-amber-500 text-white"
                              : answeredQ ? "bg-brand text-white"
                                : "bg-surface text-muted hover:bg-indigo-500/10")}
                    >
                      {questionNumbers.get(q.id)}
                      {isFlagged && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-canvas" />}
                    </button>;
                  })}
                </div>}
              </div>;
            })}</div></div>;
          })}
        </aside>
      </div>

      <div className="pointer-events-none absolute inset-y-3 right-1 w-1 overflow-hidden rounded-full" style={{ opacity: sidebarOpen ? 1 : 0 }}>
        <div
          className="absolute w-1 rounded-full bg-brand transition-[top,height] duration-150"
          style={{ top: `${sidebarThumb.top}%`, height: `${sidebarThumb.height}%`, opacity: 0.7 }}
        />
      </div>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "Collapse exercises panel" : "Open exercises panel"}
        className={cn(
          "absolute top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-brand text-white shadow-lg shadow-indigo-500/30 transition-transform duration-300 ease-out hover:scale-105",
          sidebarOpen ? "-right-3" : "left-1",
        )}
      >
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      </div>

      <main className="min-w-0 lg:flex lg:h-full lg:flex-1 lg:flex-col lg:overflow-hidden">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-2 lg:hidden">{exercises.map((item, index) => { const unlocked = exerciseUnlocked(index); return <button key={item.id} disabled={!unlocked} onClick={() => goToExercise(index)} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40", index === currentExercise ? "bg-brand text-white" : "border border-line bg-canvas text-muted")}>{!unlocked && <Lock className="h-3 w-3" />}{item.title}</button>; })}</div>

        {exercise.media && !exercise.media.mime_type.startsWith("audio/") && <div className="mb-2.5 shrink-0 rounded-2xl border border-line bg-canvas p-2.5">
          {exercise.media.mime_type.startsWith("image/") ? <img className="max-h-72 w-full rounded-xl object-contain" src={mediaUrl(exercise.media.url)} alt={exercise.media.file_name} /> : <>
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Headphones className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-wide text-muted">Listening video</p><p className="truncate text-xs font-extrabold text-ink">{exercise.media.file_name}</p></div>
              {exercise.audio_replay_limit && <span className="shrink-0 rounded-lg bg-surface px-2 py-1 text-[10px] font-bold text-muted">{Math.max(0, exercise.audio_replay_limit - (mediaPlays[exercise.id] ?? 0))} plays left</span>}
            </div>
            <video className="max-h-48 w-full rounded-xl bg-black" controls preload="metadata" src={mediaUrl(exercise.media.url)} onPlay={(event) => guardMediaPlay(exercise, event.currentTarget)} onEnded={() => recordMediaPlay(exercise)} />
          </>}
        </div>}
        {/* When a reading passage is present the screen splits: passage on the
            left (its own scroll), questions on the right. A draggable divider
            between them lets the student give either side more room. Stacks on mobile. */}
        <div ref={splitRef} className="min-h-0 lg:flex lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        {passageText && <>
        <aside style={{ "--pw": `${passageWidth}%` } as CSSProperties} className="mb-4 max-h-[42vh] shrink-0 overflow-y-auto rounded-3xl border border-line bg-canvas p-5 shadow-sm lg:mb-0 lg:max-h-none lg:w-[var(--pw)]">
          <div className="mb-3 flex items-center gap-2 text-brand">
            <PanelIcon className="h-4 w-4" /><p className="text-xs font-bold uppercase tracking-wider">{panelLabel}</p>
            {/* Text zoom: − / current / + */}
            <div className="ml-auto flex items-center gap-1">
              <button type="button" aria-label="Smaller text" title="Smaller text" disabled={passageZoom <= 12}
                onClick={() => setPassageZoom((size) => Math.max(12, size - 1.5))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface text-sm font-extrabold text-muted transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40">−</button>
              <button type="button" title="Reset text size" onClick={() => setPassageZoom(15)}
                className="min-w-10 rounded-lg px-1 py-1 text-[10px] font-bold text-muted transition hover:text-ink">{Math.round((passageZoom / 15) * 100)}%</button>
              <button type="button" aria-label="Larger text" title="Larger text" disabled={passageZoom >= 27}
                onClick={() => setPassageZoom((size) => Math.min(27, size + 1.5))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface text-sm font-extrabold text-muted transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40">+</button>
            </div>
          </div>
          {passageHtml
            ? <div className="passage-content text-ink" style={{ fontSize: `${passageZoom}px`, lineHeight: 1.85 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(passageHtml) }} />
            : <div className="whitespace-pre-wrap text-ink" style={{ fontSize: `${passageZoom}px`, lineHeight: 1.85 }}>{passagePlain}</div>}
        </aside>
        <div onPointerDown={startSplitDrag} title="Drag to resize" className="group hidden shrink-0 cursor-col-resize touch-none items-center justify-center px-2 lg:flex">
          <div className="h-16 w-1.5 rounded-full bg-line transition group-hover:bg-brand" />
        </div>
        </>}

        <section className="min-h-0 min-w-0 rounded-3xl border border-line bg-canvas p-4 shadow-sm sm:p-5 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden">
          <div className={cn("min-h-0 gap-4 lg:flex-1 lg:overflow-y-auto lg:pr-2", bankOptions.length && "grid lg:grid-cols-[minmax(0,1fr)_210px]")}>
            <div className={cn("mx-auto w-full space-y-3", isGapMatch ? "max-w-6xl" : "max-w-3xl")}>
            {/* Exercise heading lives with the questions: number + full rubric
                in a readable size (the sticky header only keeps the test title). */}
            <div className="pb-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-brand">Exercise {currentExercise + 1} <span className="font-bold text-muted">of {exercises.length}</span></p>
              {headerInstructions && <h2 className="mt-1.5 text-lg font-extrabold leading-8 text-ink sm:text-[21px] sm:leading-9">{headerInstructions}</h2>}
            </div>
            {checkedTaskIds.includes(exercise.id) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-500/10 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-700"><Lock className="h-4 w-4 shrink-0" /> This exercise is finished — answers are locked.</p>
              <button type="button" onClick={() => unlockExercise(exercise)} className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-500/15">Unlock & edit</button>
            </div>}
            {exercise.interaction?.kind === "cloze_passage" ? renderClozePassage(exercise)
              : isGapMatch ? renderGapMatch(exercise)
              : exercise.questions.map((question) => {
              const number = questionNumbers.get(question.id);
              const result = exerciseResults[question.id];
              const checked = question.id in exerciseResults;
              return <article key={question.id} id={`q-${question.id}`} className={cn(
                "group/card scroll-mt-4 rounded-2xl border p-4 transition-all duration-150 sm:p-5",
                result === true ? "border-emerald-300 bg-emerald-500/[.04]"
                  : result === false ? "border-red-300 bg-red-500/[.04]"
                    : checked ? "border-amber-300 bg-amber-500/[.04]"
                    : hasAnswer(answers[question.id]) ? "border-indigo-200 bg-indigo-500/[.025]"
                    : "border-line bg-canvas hover:border-indigo-200/70 hover:shadow-sm",
              )}>
              <div className="flex items-start gap-3.5">
                <span className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold transition-colors",
                  result === true ? "bg-emerald-500 text-white" : result === false ? "bg-red-500 text-white"
                    : checked ? "bg-amber-500 text-white"
                    : hasAnswer(answers[question.id]) ? "bg-brand text-white"
                    : question.is_example ? "bg-sky-500/10 text-sky-600" : "bg-surface text-muted",
                )}>{result === true ? <CheckCircle2 className="h-5 w-5" /> : result === false ? <XCircle className="h-5 w-5" /> : checked ? <Clock3 className="h-5 w-5" /> : question.is_example ? "e.g" : number}</span>
                <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3">{renderPrompt(exercise, question)}{!question.is_example && <button aria-label={`Flag question ${number}`} title="Flag for review" onClick={() => toggleFlag(question.id)} className={cn(
                  "shrink-0 rounded-lg p-2 transition-all",
                  flagged.includes(question.id)
                    ? "bg-orange-500/10 text-orange-500"
                    : "text-muted/50 hover:bg-orange-500/10 hover:text-orange-500 sm:opacity-0 sm:group-hover/card:opacity-100",
                )}><Bookmark className={cn("h-4 w-4", flagged.includes(question.id) && "fill-current")} /></button>}</div>{question.is_example && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-600"><CheckCircle2 className="h-3.5 w-3.5" /> Example — not scored</p>}{renderAnswer(exercise, question)}{checked && result === null && <p className="mt-3 text-xs font-bold text-brand">🤖 The AI will grade this after you submit the test.</p>}</div>
              </div>
            </article>;
          })}
              {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
              <div className="mt-2 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" disabled={currentExercise === 0} onClick={() => goToExercise(currentExercise - 1)}><ChevronLeft className="h-4 w-4" /> Previous</Button>
                <span className="order-first text-center text-xs font-bold text-muted sm:order-none">{exerciseAnswered}/{exerciseQuestions.length} answered in this exercise</span>
                {!checkedTaskIds.includes(exercise.id)
                  ? <Button variant="secondary" onClick={() => checkExercise(exercise)} disabled={checkingExercise}><Check className="h-4 w-4" /> {checkingExercise ? "Checking…" : "Finish Exercise"}</Button>
                  : currentExercise < exercises.length - 1
                    ? <Button onClick={() => goToExercise(currentExercise + 1)}>Next Exercise <ChevronRight className="h-4 w-4" /></Button>
                    : <Button onClick={() => setShowReview(true)}>Review & Submit <ChevronRight className="h-4 w-4" /></Button>}
              </div>
            </div>

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
        </section>
        </div>
      </main>
    </div>
  </div>;
}
