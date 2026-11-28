"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, BookOpen, Bookmark, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, GripVertical,
  Headphones, Lock, LogOut, Maximize, PauseCircle, PenLine, Pin, PinOff, Play, RotateCcw, Send, ShieldAlert, X, XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AudioPlayer } from "@/components/exam/audio-player";
import { ExamCountdown, timeLeft, type ClockBase } from "@/components/exam/exam-countdown";
import { GapMatch } from "@/components/exam/gap-match";
import { enterFullscreen, exitFullscreen, fullscreenSupported, useExamLockdown, useFullscreenState, type ViolationKind } from "@/components/exam/use-exam-lockdown";
import { BrowserAdvice } from "@/components/exam/browser-advice";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";
import { useLang } from "@/lib/i18n";
import { sanitizeHtml } from "@/lib/sanitize";
import { Input } from "@/components/ui/input";
import { api, mediaUrl } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";
import {
  answerChoices, choiceGridClass, exampleAnswerText, hasAnswer, inlineAlternative,
  interactionOptions, orderingTokens, renderInstructionBlocks, renumberExerciseTitle, scorableQuestions, textAnswer,
  type AnswerValue, type ApiQuestion, type ApiSection, type ApiTask, type AttemptState,
  type Exercise, type ExerciseResult, type TestDetail,
} from "@/lib/exam-helpers";

export function ExamRunner({ testId, resultBasePath, initialAttemptId }: { testId: string; resultBasePath: string; initialAttemptId?: string }) {
  const { lang, t } = useLang();
  const [test, setTest] = useState<TestDetail | null>(null);
  const [attemptId, setAttemptId] = useState("");
  const [taskOrder, setTaskOrder] = useState<string[] | null>(null);
  const [currentExercise, setCurrentExercise] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  // Clock anchor (time left at a moment). <ExamCountdown> does the per-second
  // ticking, so this screen re-renders only when the anchor moves.
  const [clockBase, setClockBase] = useState<ClockBase>({ remaining: 0, at: 0 });
  const clockRef = useRef(clockBase);
  clockRef.current = clockBase;
  const [timerStarted, setTimerStarted] = useState(false);
  // New attempt: the briefing shows first and the clock waits for "Start".
  const [awaitingStart, setAwaitingStart] = useState(false);
  const awaitingRef = useRef(awaitingStart);
  awaitingRef.current = awaitingStart;
  const [beginning, setBeginning] = useState(false);
  const [fullscreenRefused, setFullscreenRefused] = useState(false);
  // Practice only: the expected answer of a question answered wrong.
  const [correctAnswers, setCorrectAnswers] = useState<Record<string, string>>({});
  // Examiner-proctored attempt: the examiner can pause the clock or remove
  // the student; a heartbeat keeps both sides in sync.
  const [proctored, setProctored] = useState(false);
  const [paused, setPaused] = useState(false);
  const [removed, setRemoved] = useState(false);
  // The examiner changed the exam length mid-exam: a short notice says by how much.
  const [timeNotice, setTimeNotice] = useState<{ minutes: number; delta: number } | null>(null);
  const limitRef = useRef<number | null>(null);
  useEffect(() => {
    if (!timeNotice) return;
    const timer = window.setTimeout(() => setTimeNotice(null), 10000);
    return () => window.clearTimeout(timer);
  }, [timeNotice]);
  // Exam mode: fullscreen lock + a count of trips away from the exam. The
  // server keeps the count; reaching maxViolations submits the attempt.
  const [violationBase, setViolationBase] = useState(0);
  const [maxViolations, setMaxViolations] = useState(3);
  const [examMode, setExamMode] = useState(true);
  // Set while the student deliberately leaves (submit, save & exit, back) so
  // the fullscreen exit that follows is not counted as a violation.
  const [leaving, setLeaving] = useState(false);
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
  const { confirm, dialog } = useConfirm();

  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarPinned = useRef(false);
  const [sidebarThumb, setSidebarThumb] = useState({ top: 0, height: 100 });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Pin toggle: on by default — keeps the exercises panel open and stops it
  // from auto-collapsing on load or on mouse-out.
  const [sidebarPinnedOn, setSidebarPinnedOn] = useState(true);

  // Draggable divider between the reading passage and the questions. The user
  // grabs it and drags left/right to give either side more room. Default 56%.
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingSplit = useRef(false);
  // Desktop splits left/right (x), phones and tablets top/bottom (y).
  const dragAxis = useRef<"x" | "y">("x");
  const passageScrollRef = useRef<HTMLElement>(null);
  const splitHandleRef = useRef<HTMLDivElement>(null);
  const questionsScrollRef = useRef<HTMLDivElement>(null);
  const [passageWidth, setPassageWidth] = useState(56);
  // Phones: the passage's share of the screen height, 30–70%, default 50.
  const [passageHeight, setPassageHeight] = useState(50);
  // Reading passage text size (px) — the +/− zoom buttons step it.
  const [passageZoom, setPassageZoom] = useState(15);
  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!draggingSplit.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      if (dragAxis.current === "y") {
        // Share of the height left after the divider bar itself.
        const bar = splitHandleRef.current?.getBoundingClientRect().height ?? 0;
        const usable = Math.max(1, rect.height - bar);
        setPassageHeight(Math.min(70, Math.max(30, ((event.clientY - rect.top - bar / 2) / usable) * 100)));
        return;
      }
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
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);
  function startSplitDrag(event: ReactPointerEvent, axis: "x" | "y" = "x") {
    event.preventDefault();
    // Keep receiving the finger's moves even when it leaves the thin handle.
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* old browsers */ }
    dragAxis.current = axis;
    draggingSplit.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "y" ? "row-resize" : "col-resize";
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

  // Open the exercises panel, then auto-collapse after `durationMs` (used on load) —
  // unless the persistent pin is on, in which case it just stays open.
  function openSidebarFor(durationMs: number) {
    sidebarPinned.current = false;
    setSidebarOpen(true);
    clearSidebarTimer();
    if (sidebarPinnedOn) return;
    sidebarTimer.current = setTimeout(() => setSidebarOpen(false), durationMs);
  }

  // Hover in: keep an already-open panel from auto-collapsing while the pointer is over it.
  // Does not reopen a collapsed panel — that stays an explicit click on the handle.
  function holdSidebar() {
    if (!sidebarOpen) return;
    if (!sidebarPinned.current) clearSidebarTimer();
  }

  // Hover out: collapse shortly after leaving, unless pinned (via the handle, or the
  // persistent pin toggle).
  function releaseSidebar() {
    if (sidebarPinnedOn || sidebarPinned.current) return;
    clearSidebarTimer();
    sidebarTimer.current = setTimeout(() => setSidebarOpen(false), 700);
  }

  // The round handle: `<` collapses the whole panel now; `>` opens it, pinned for 15s
  // (or indefinitely, if the persistent pin toggle is on).
  function toggleSidebar() {
    clearSidebarTimer();
    if (sidebarOpen) {
      sidebarPinned.current = false;
      setSidebarOpen(false);
    } else {
      sidebarPinned.current = true;
      setSidebarOpen(true);
      requestAnimationFrame(updateSidebarThumb);
      if (!sidebarPinnedOn) {
        sidebarTimer.current = setTimeout(() => { sidebarPinned.current = false; setSidebarOpen(false); }, 15000);
      }
    }
  }

  // The pin toggle in the panel header: turning it on keeps the panel open for good;
  // turning it off restores the normal hover/auto-collapse behaviour.
  function toggleSidebarPin() {
    setSidebarPinnedOn((current) => {
      const next = !current;
      if (next) {
        clearSidebarTimer();
        setSidebarOpen(true);
      }
      return next;
    });
  }

  const exercises = useMemo<Exercise[]>(() => {
    if (!test) return [];
    // Exercises render in Task.order_index order by default. When the attempt
    // carries a shuffled task_order (set once at attempt creation, see
    // shuffled_task_order on the backend), reorder each section's tasks to
    // match it instead — the section grouping itself never changes.
    const rank = taskOrder ? new Map(taskOrder.map((id, index) => [id, index])) : null;
    let position = 0;
    return test.sections.flatMap((section) => {
      const tasks = rank ? [...section.tasks].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)) : section.tasks;
      return tasks.map((task) => ({ ...task, section, title: renumberExerciseTitle(task.title, ++position) }));
    });
  }, [test, taskOrder]);
  const questions = useMemo(
    () => exercises.flatMap((exercise) => exercise.questions),
    [exercises],
  );
  const lockedQuestions = useMemo(() => new Set(
    exercises.filter((item) => checkedTaskIds.includes(item.id)).flatMap((item) => item.questions.map((question) => question.id)),
  ), [exercises, checkedTaskIds]);
  // Per-exercise panel defaults: writing/speaking briefs are short, so their
  // panel starts at the minimum width with larger text (140%); reading
  // passages get the roomier split and normal text.
  useEffect(() => {
    const active = exercises[currentExercise];
    if (!active) return;
    const manual = ["writing", "rich_text_question", "speaking_prompt_placeholder"].includes(active.type);
    setPassageWidth(manual ? 30 : 56);
    setPassageHeight(manual ? 40 : 50);
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
    let active = true;
    const query = initialAttemptId ? `?attempt_id=${encodeURIComponent(initialAttemptId)}` : "";
    api<{ attempt: AttemptState; test: TestDetail }>(`/tests/${testId}/open${query}`, { method: "POST" })
      .then(({ test: detail, attempt }) => {
      if (!active) return;
      setTest(detail);
      limitRef.current = detail.time_limit_minutes;
      setAttemptId(attempt.id);
      setTaskOrder(attempt.task_order ?? null);
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
      const waiting = Boolean(attempt.awaiting_start);
      setClockBase({ remaining: Math.max(0, detail.time_limit_minutes * 60 - (attempt.elapsed_seconds ?? 0)), at: waiting ? 0 : Date.now() });
      setAwaitingStart(waiting);
      setProctored(Boolean(attempt.exam_session_id));
      setPaused(Boolean(attempt.paused));
      setViolationBase(attempt.violations ?? 0);
      setMaxViolations(attempt.max_violations ?? 3);
      setExamMode(attempt.exam_mode !== false);
      setTimerStarted(!waiting);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t("Testni yuklab bo'lmadi.", "Unable to load this test.")); });
    return () => { active = false; };
    // Switching language must not reload the test; t only shapes the error text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, initialAttemptId]);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Proctored heartbeat: tells the examiner the student is still on the exam,
  // and picks up the examiner's pause/resume, removal or force-submit, plus
  // the server's authoritative time left.
  useEffect(() => {
    if (!proctored || !attemptId) return;
    let alive = true;
    const beat = async () => {
      try {
        const state = await api<{ status: string; paused: boolean; removed: boolean; remaining_seconds: number; exam_mode?: boolean; time_limit_minutes?: number }>(
          `/attempts/${attemptId}/heartbeat`, { method: "POST" },
        );
        if (!alive) return;
        const limit = state.time_limit_minutes;
        if (limit && limitRef.current && limit !== limitRef.current) {
          const delta = limit - limitRef.current;
          limitRef.current = limit;
          setTest((current) => current && { ...current, time_limit_minutes: limit });
          if (!awaitingRef.current) setClockBase({ remaining: state.remaining_seconds, at: Date.now() });
          setTimeNotice({ minutes: limit, delta });
        }
        if (state.status !== "IN_PROGRESS") {
          try {
            localStorage.removeItem(`exam-progress:${attemptId}`);
            localStorage.removeItem(`exam-position:${attemptId}`);
          } catch { /* ignore */ }
          setLeaving(true);
          router.replace(`${resultBasePath}/${attemptId}`);
          return;
        }
        // Re-anchor the clock on pause/resume or when it drifted from the server
        // (not while the briefing is up — the clock has not started).
        if (awaitingRef.current) { setRemoved(state.removed); setPaused(state.paused); return; }
        const local = timeLeft(clockRef.current, pausedRef.current);
        if (pausedRef.current !== state.paused || Math.abs(local - state.remaining_seconds) > 2) {
          setClockBase({ remaining: state.remaining_seconds, at: Date.now() });
        }
        setRemoved(state.removed);
        setPaused(state.paused);
        setExamMode(state.exam_mode !== false);
      } catch { /* offline — the next beat retries */ }
    };
    beat();
    const timer = window.setInterval(beat, 5000);
    return () => { alive = false; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proctored, attemptId]);


  // Leaving a paused exam must flush answers the moment it resumes.
  useEffect(() => {
    if (!paused && proctored && saveState === "error") saveAnswers().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  useEffect(() => {
    if (!test) return;
    updateSidebarThumb();
    openSidebarFor(5000);
    return () => { if (sidebarTimer.current) clearTimeout(sidebarTimer.current); };
  }, [test]);

  const fullscreenState = useFullscreenState();
  // Exam mode off (or fullscreen dropped): a button to go (back) fullscreen
  // with no warning attached. With exam mode on the lockdown overlay does it.
  const offerFullscreen = Boolean(fullscreenState?.supported && !fullscreenState.on && !examMode && !fullscreenRefused && timerStarted);
  const lockdown = useExamLockdown({
    active: examMode && timerStarted && Boolean(attemptId) && !paused && !removed && !leaving,
    initialViolations: violationBase,
    fullscreenRefused,
    onViolation: (kind, localCount) => { reportViolation(kind, localCount).catch(() => {}); },
  });

  function goFullscreen() {
    enterFullscreen().then((ok) => { if (!ok) setFullscreenRefused(true); }).catch(() => {});
  }
  // Leaving the exam page (result, dashboard) leaves fullscreen too.
  useEffect(() => () => exitFullscreen(), []);

  // Each trip away is reported to the server, which keeps the count and
  // submits the attempt itself on the last one (saved answers are pushed first).
  async function reportViolation(kind: ViolationKind, localCount: number) {
    if (!attemptId) return;
    await saveAnswers().catch(() => {});
    try {
      const state = await api<{ violations: number; max_violations: number; submitted: boolean }>(
        `/attempts/${attemptId}/violation`, { method: "POST", body: JSON.stringify({ kind }) },
      );
      lockdown.syncViolations(state.violations);
      setMaxViolations(state.max_violations);
      if (state.submitted) {
        try {
          localStorage.removeItem(`exam-progress:${attemptId}`);
          localStorage.removeItem(`exam-position:${attemptId}`);
        } catch { /* ignore */ }
        setLeaving(true);
        router.replace(`${resultBasePath}/${attemptId}`);
      }
    } catch {
      // Offline: still enforce the limit with a normal submit.
      if (localCount >= maxViolations) submit();
    }
  }

  // "Start" on the briefing: fullscreen is requested inside the click (browsers
  // allow it only there), then the server starts the clock.
  async function beginExam() {
    if (!attemptId || beginning) return;
    setBeginning(true);
    setError("");
    // Fullscreen for everyone whose browser allows it; exam mode only adds
    // the warnings for leaving it.
    const fullscreen = fullscreenSupported() ? enterFullscreen() : Promise.resolve(true);
    try {
      const state = await api<AttemptState>(`/attempts/${attemptId}/begin`, { method: "POST" });
      if (!(await fullscreen)) setFullscreenRefused(true);
      if (test) setClockBase({ remaining: Math.max(0, test.time_limit_minutes * 60 - (state.elapsed_seconds ?? 0)), at: Date.now() });
      setAwaitingStart(false);
      setTimerStarted(true);
    } catch (reason) {
      exitFullscreen();
      setError(reason instanceof Error ? reason.message : t("Boshlab bo‘lmadi.", "Unable to start."));
    } finally {
      setBeginning(false);
    }
  }

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
    setLeaving(true);
    try {
      await saveAnswers();
      await api(`/attempts/${attemptId}/pause`, { method: "POST" });
    } catch (reason) {
      setLeaving(false);
      setError(reason instanceof Error ? reason.message : t("Chiqishdan oldin saqlab bo'lmadi. Internetni tekshiring.", "Could not save before exit. Check your connection."));
      return;
    }
    router.push("/dashboard");
  }

  function leaveExam() {
    if (!proctored) { saveAndExit(); return; }
    setLeaving(true);
    saveAnswers().catch(() => {}).finally(() => router.push("/dashboard"));
  }

  // Wipe everything and start the test from scratch: answers, exercise locks,
  // results and the timer all reset.
  function restartAttempt() {
    if (!attemptId) return;
    confirm({
      title: t("Testni boshidan boshlaysizmi?", "Start the test over?"),
      description: t("Barcha javoblaringiz va natijalaringiz o'chiriladi.", "All your answers and results will be erased."),
      confirmLabel: t("Boshidan boshlash", "Start over"),
      variant: "danger",
      onConfirm: doRestartAttempt,
    });
  }

  async function doRestartAttempt() {
    if (!attemptId) return;
    try {
      await api(`/attempts/${attemptId}/restart`, { method: "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Testni qayta boshlab bo'lmadi.", "Unable to restart the test."));
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
    if (test) setClockBase({ remaining: test.time_limit_minutes * 60, at: Date.now() });
  }

  async function submit() {
    if (!attemptId) return;
    setLeaving(true);
    try {
      await saveAnswers();
      try {
        localStorage.removeItem(`exam-progress:${attemptId}`);
        localStorage.removeItem(`exam-position:${attemptId}`);
      } catch { /* ignore */ }
      await api(`/attempts/${attemptId}/submit`, { method: "POST" });
      router.push(`${resultBasePath}/${attemptId}`);
    } catch (reason) {
      setLeaving(false);
      setError(reason instanceof Error ? reason.message : t("Testni topshirib bo'lmadi.", "Unable to submit this test."));
    }
  }

  function goToExercise(index: number) {
    if (index > 0 && !checkedTaskIds.includes(exercises[index - 1]?.id)) return;
    setCurrentExercise(index);
    setSelectedToken(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Split screen: each half scrolls by itself — start both at the top.
    passageScrollRef.current?.scrollTo({ top: 0 });
    questionsScrollRef.current?.scrollTo({ top: 0 });
  }

  function exerciseUnlocked(index: number) {
    return index === 0 || checkedTaskIds.includes(exercises[index - 1]?.id);
  }

  function guardMediaPlay(exercise: Exercise, media: HTMLMediaElement) {
    const limit = exercise.audio_replay_limit;
    if (limit && (mediaPlays[exercise.id] ?? 0) >= limit) {
      media.pause();
      setError(t(`Bu yozuvni faqat ${limit} marta tinglash mumkin.`, `This recording can only be played ${limit} time${limit === 1 ? "" : "s"}.`));
    }
  }

  function recordMediaPlay(exercise: Exercise) {
    setMediaPlays((current) => ({ ...current, [exercise.id]: (current[exercise.id] ?? 0) + 1 }));
  }

  function setAnswer(questionId: string, answer: AnswerValue) {
    // A finished exercise is locked (the server ignores changes too).
    if (lockedQuestions.has(questionId)) return;
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
        setError(reason instanceof Error ? reason.message : t("Mashqni qayta ochib bo'lmadi.", "Unable to unlock this exercise."));
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

  function scrollToQuestion(questionId: string) {
    document.getElementById(`q-${questionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function checkExercise(exercise: Exercise) {
    if (!attemptId) return;
    const unanswered = scorableQuestions(exercise.questions).filter((question) => !hasAnswer(answers[question.id]));
    confirm({
      title: unanswered.length
        ? t(`${unanswered.length} ta savol javobsiz`, `${unanswered.length} unanswered`)
        : t("Mashqni yakunlaysizmi?", "Finish this exercise?"),
      description: t("Keyin javoblarni o‘zgartirib bo‘lmaydi.", "Answers can’t be changed afterwards."),
      confirmLabel: t("Yakunlash", "Finish"),
      cancelLabel: unanswered.length ? t("Javob berish", "Answer it") : undefined,
      onCancel: unanswered.length ? () => scrollToQuestion(unanswered[0].id) : undefined,
      onConfirm: () => doCheckExercise(exercise),
    });
  }

  async function doCheckExercise(exercise: Exercise) {
    if (!attemptId) return;
    setCheckingExercise(true);
    setError("");
    try {
      await saveAnswers();
      const result = await api<{ results: { question_id: string; is_correct: boolean | null; is_example?: boolean; correct_answer?: string | null }[] }>(
        `/attempts/${attemptId}/tasks/${exercise.id}/check`,
        { method: "POST" },
      );
      // An examiner exam shows no right/wrong until the end. In practice,
      // examples are reference items — never marked right/wrong.
      if (!proctored) {
        setExerciseResults((current) => ({
          ...current,
          ...Object.fromEntries(result.results.filter((item) => !item.is_example).map((item) => [item.question_id, item.is_correct])),
        }));
        setCorrectAnswers((current) => ({
          ...current,
          ...Object.fromEntries(result.results.filter((item) => item.correct_answer).map((item) => [item.question_id, item.correct_answer as string])),
        }));
      }
      setCheckedTaskIds((current) => current.includes(exercise.id) ? current : [...current, exercise.id]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Mashqni tekshirib bo'lmadi.", "Unable to check this exercise."));
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
            : value ? "border-brand bg-orange-500/5 text-ink" : "border-line bg-surface text-muted hover:border-orange-300",
      )}
    >
      <span className="max-w-48 truncate">{label || (selectedToken ? t("Shu yerga qo'yish", "Place here") : t("Javobni qo'ying", "Drop answer"))}</span>
      {result === true && <CheckCircle2 className="h-4 w-4 shrink-0" />}
      {result === false && <XCircle className="h-4 w-4 shrink-0" />}
      {value && <span
        role="button"
        aria-label={t(`${questionNumbers.get(question.id)}-javobni tozalash`, `Clear answer ${questionNumbers.get(question.id)}`)}
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
    // Gap-fill sentence: put a small input right inside each blank instead of
    // one detached box below (multi-blank sentences need one box per blank,
    // not one box for the whole sentence).
    if (!alternative && !answerChoices(exercise, question).length && /_{2,}/.test(question.prompt)) {
      const segments = question.prompt.split(/_{2,}/);
      const blankValues = textAnswer(answers[question.id]).split(",").map((part) => part.trim());
      const setBlank = (index: number, value: string) => {
        const next = [...blankValues];
        while (next.length < segments.length - 1) next.push("");
        next[index] = value;
        setAnswer(question.id, next.join(", "));
      };
      const children: ReactNode[] = [];
      segments.forEach((segment, index) => {
        if (index >= segments.length - 1) {
          children.push(<span key={`text-${index}`}>{segment}</span>);
          return;
        }
        // One to three letters stuck to the blank with no space before it
        // (e.g. "a s___ ", "a T-shirt, sh___") are a starting-letters hint,
        // not ordinary sentence text — show them as the box's placeholder
        // (disappears the instant the student types, like any normal
        // placeholder) instead of loose in the sentence, so every hinted gap
        // looks the same and the student types the whole word.
        const hintMatch = segment.match(/(?:^|\s)([A-Za-z]{1,3})$/);
        const hintLetter = hintMatch?.[1] ?? "";
        const displaySegment = hintLetter ? segment.slice(0, segment.length - hintLetter.length) : segment;
        // "l…" rather than a bare "l", which reads as a capital "I".
        const hintPlaceholder = hintLetter ? `${hintLetter}…` : "";
        children.push(<span key={`text-${index}`}>{displaySegment}</span>);
        const fullValue = blankValues[index] ?? "";
        children.push(
          <input
            key={`blank-${index}`}
            aria-label={`Answer ${questionNumbers.get(question.id)} — blank ${index + 1}`}
            value={fullValue}
            placeholder={hintPlaceholder}
            onChange={(event) => setBlank(index, event.target.value)}
            size={Math.max(3, fullValue.length || hintPlaceholder.length || 5)}
            className="mx-1 inline-block min-w-8 max-w-full rounded-lg border-2 border-line bg-canvas px-2 py-1 text-center align-baseline font-bold text-ink outline-none transition placeholder:font-bold placeholder:text-muted focus:border-brand focus:ring-4 focus:ring-orange-500/10"
          />,
        );
      });
      return <p className="whitespace-pre-wrap text-base font-bold leading-9 text-ink sm:text-lg">{children}</p>;
    }
    if (!alternative) {
      return <p className="whitespace-pre-wrap text-base font-bold leading-7 text-ink sm:text-lg">{question.prompt}</p>;
    }
    const selected = textAnswer(answers[question.id]);
    const result = exerciseResults[question.id];
    const optionClass = (option: string) => cn(
      "mx-1 rounded-lg border px-2.5 py-1 font-extrabold transition",
      selected !== option && "border-line bg-surface text-muted hover:border-orange-300 hover:text-ink",
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
        <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-orange-200 bg-orange-500/[.025] p-3">
          {selected.length ? selected.map((token, index) => <button type="button" key={`${token}-${index}`} onClick={() => setAnswer(question.id, selected.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white">{index + 1}. {token}</button>) : <span className="text-xs font-semibold text-muted">{t("So‘zlarni tartib bilan bosing.", "Tap the words in order.")}</span>}
        </div>
        <div className="flex flex-wrap gap-2">{remaining.map((token, index) => <button type="button" key={`${token}-${index}`} onClick={() => setAnswer(question.id, [...selected, token])} className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm font-bold text-ink hover:border-brand hover:text-brand">{token}</button>)}</div>
        {selected.length > 0 && <button type="button" onClick={() => setAnswer(question.id, [])} className="flex items-center gap-1 text-xs font-bold text-muted hover:text-ink"><RotateCcw className="h-3 w-3" /> {t("Tartibni tiklash", "Reset order")}</button>}
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
            "group flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left text-sm font-semibold transition duration-150",
            active
              ? "border-brand bg-orange-500/[.07] text-ink shadow-sm shadow-orange-500/10"
              : "border-line bg-canvas text-ink hover:-translate-y-px hover:border-orange-300 hover:shadow-sm",
          )}
        ><span className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 text-[11px] font-extrabold transition duration-150",
          active ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted group-hover:border-orange-300 group-hover:text-brand",
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
              "flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-bold transition duration-150",
              active
                ? "border-brand bg-brand text-white shadow-md shadow-orange-500/25"
                : "border-line bg-canvas text-ink hover:-translate-y-px hover:border-orange-300 hover:shadow-sm",
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
            "group flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left text-sm font-semibold transition duration-150",
            active
              ? "border-brand bg-orange-500/[.07] text-ink shadow-sm shadow-orange-500/10"
              : "border-line bg-canvas text-ink hover:-translate-y-px hover:border-orange-300 hover:shadow-sm",
          )}
        ><span className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-extrabold transition duration-150",
          active ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted group-hover:border-orange-300 group-hover:text-brand",
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
          <span className="rounded-full bg-orange-500/10 px-3 py-1 text-brand">🤖 {t("AI baholaydi", "AI graded")}</span>
          <span className={cn(
            "rounded-full px-3 py-1 transition-colors",
            count === 0 ? "bg-surface text-muted"
              : maximum && count > maximum ? "bg-red-500/10 text-red-600"
              : !inRange ? "bg-amber-500/10 text-amber-600"
              : "bg-emerald-500/10 text-emerald-600",
          )}>
            {count} {t("so'z", "words")}{minimum || maximum ? ` · ${t("tavsiya", "guide")} ${minimum ?? 0}–${maximum ?? "∞"}` : ""}{count > 0 && inRange ? " ✓" : ""}
          </span>
        </div>
        {/* Short answers (a sentence or two) get a compact box; essays without a
            tight word cap still get the full-page writing sheet. */}
        <textarea
          aria-label={`Answer ${questionNumbers.get(question.id)}`}
          className={cn(
            "w-full resize-y rounded-2xl border border-line bg-canvas p-5 text-[15px] leading-8 outline-none transition focus:border-brand focus:ring-4 focus:ring-orange-500/10",
            maximum && maximum <= 40 ? "min-h-[120px]" : "min-h-[52vh]",
          )}
          value={content}
          onChange={(event) => setAnswer(question.id, event.target.value)}
          placeholder={t("Javobingizni yozing…", "Write your answer…")}
        />
      </div>;
    }

    if (exercise.type === "error_correction") {
      return <div className="mt-5"><Input
        aria-label={`Answer ${questionNumbers.get(question.id)}`}
        value={textAnswer(answer)}
        onChange={(event) => setAnswer(question.id, event.target.value)}
        placeholder={t("To'g'ri gapni qayta yozing…", "Rewrite the correct sentence…")}
      /></div>;
    }
    // Gap-fill blanks are now typed inline inside the sentence (see renderPrompt) —
    // no separate box needed below.
    if (/_{2,}/.test(question.prompt)) return null;
    return <div className="mt-5"><Input
      aria-label={`Answer ${questionNumbers.get(question.id)}`}
      value={textAnswer(answer)}
      onChange={(event) => setAnswer(question.id, event.target.value)}
      placeholder={t("Javobingizni kiriting…", "Type your answer…")}
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
                        : "border-line bg-surface text-muted hover:border-orange-300 hover:text-ink",
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

  if (error && !test) return <div className="grid min-h-screen place-items-center bg-surface p-6"><div className="max-w-md rounded-3xl border border-line bg-canvas p-7 text-center"><h1 className="text-xl font-extrabold text-ink">{t("Test mavjud emas", "Test unavailable")}</h1><p className="mt-3 text-sm text-red-600">{error}</p><Button className="mt-5" onClick={() => router.back()}>{t("Orqaga", "Go Back")}</Button></div></div>;
  if (!test || !exercises.length) return <div className="grid min-h-screen place-items-center bg-surface"><div className="text-center"><span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-orange-100 border-t-brand" /><p className="mt-4 text-sm font-bold text-muted">{t("Test tayyorlanmoqda…", "Preparing your test…")}</p></div></div>;

  const exercise = exercises[Math.min(currentExercise, exercises.length - 1)];
  // A reading text may be typed into the dedicated (rich-text) passage field OR
  // into the instructions field. Either way, treat a long block as the passage
  // so the screen splits (text ↔ questions) instead of hiding it in a header —
  // but not for listening exercises, where a long instruction is just a long
  // instruction, not a "Reading passage" (the audio player covers the content).
  const isListeningTask = !!exercise.media?.mime_type?.startsWith("audio/");
  const passageHtml = exercise.passage_html?.trim() || "";
  const passagePlain = !passageHtml && !isListeningTask && exercise.instructions.trim().length > 160 ? exercise.instructions.trim() : "";
  const passageText = passageHtml || passagePlain;
  const split = Boolean(passageText);
  // The same split panel serves two jobs: a reading text for reading
  // exercises, and the task brief for writing/speaking exercises — the label
  // and icon follow the exercise type.
  const isManualTask = ["writing", "rich_text_question", "speaking_prompt_placeholder"].includes(exercise.type);
  const PanelIcon = isManualTask ? PenLine : BookOpen;
  const panelLabel = isManualTask ? t("Writing topshirig'i", "Writing task") : t("Reading matni", "Reading passage");
  const headerInstructions = exercise.instructions.trim() && exercise.instructions.trim() !== passageText
    ? exercise.instructions : "";
  const scoredQuestions = scorableQuestions(questions);
  const exerciseQuestions = scorableQuestions(exercise.questions);
  const answered = scoredQuestions.filter((question) => hasAnswer(answers[question.id])).length;
  const exerciseAnswered = exerciseQuestions.filter((question) => hasAnswer(answers[question.id])).length;
  const exerciseChecked = checkedTaskIds.includes(exercise.id);
  const firstUnanswered = exerciseQuestions.find((question) => !hasAnswer(answers[question.id]));
  const time = <ExamCountdown base={clockBase} paused={paused} />;
  const timeBanner = timeNotice && <div role="status" className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex justify-center px-4">
    <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-teal-500/30 bg-canvas px-4 py-3 shadow-lift">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", timeNotice.delta > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600")}><Clock3 className="h-4 w-4" /></span>
      <p className="text-sm font-bold text-ink">{timeNotice.delta > 0
        ? t(`+${timeNotice.delta} daqiqa qo‘shildi`, `+${timeNotice.delta} minutes added`)
        : t(`${-timeNotice.delta} daqiqa kamaytirildi`, `${-timeNotice.delta} minutes taken off`)}
        <span className="block text-xs font-semibold text-muted">{t(`Jami: ${formatDuration(timeNotice.minutes * 60, lang)}`, `Total: ${formatDuration(timeNotice.minutes * 60, lang)}`)}</span></p>
      <button type="button" aria-label={t("Yopish", "Close")} onClick={() => setTimeNotice(null)} className="rounded-lg p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
    </div>
  </div>;
  const proctorOverlay = proctored && (paused || removed) && <div className="fixed inset-0 z-[60] grid place-items-center bg-[#0b1020]/80 p-4 backdrop-blur-sm">
    <div className="w-full max-w-md rounded-3xl border border-line bg-canvas p-8 text-center shadow-lift">
      {removed ? <ShieldAlert className="mx-auto h-14 w-14 text-red-500" /> : <PauseCircle className="mx-auto h-14 w-14 animate-pulse text-violet-500" />}
      <h2 className="mt-5 text-2xl font-extrabold text-ink">{removed ? t("Siz imtihondan chiqarildingiz", "You were removed from this exam") : t("Imtihon to'xtatildi", "Exam paused")}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{removed
        ? t("Examiner sizni imtihondan chiqardi.", "The examiner removed you from this exam.")
        : t("Vaqtingiz to‘xtagan. Examiner davom ettirishini kuting.", "Your time is stopped. Wait for the examiner.")}</p>
      {!removed && <p className="mt-5 inline-flex items-center gap-2 rounded-xl bg-surface px-4 py-2 font-mono text-lg font-extrabold text-ink"><Clock3 className="h-4 w-4 text-brand" />{time}</p>}
      {removed && <Button className="mt-6" onClick={() => router.replace("/dashboard")}>{t("Bosh sahifa", "Dashboard")}</Button>}
    </div>
  </div>;
  const violationsLeft = Math.max(0, maxViolations - lockdown.violations);
  // Opaque on purpose: whatever is captured while away shows no questions.
  const lockdownOverlay = examMode && lockdown.away && !paused && !removed && !leaving && <div role="alertdialog" aria-modal="true" aria-labelledby="lockdown-title" className="fixed inset-0 z-[70] grid place-items-center bg-[#0b1020] p-4">
    <div className="w-full max-w-md rounded-3xl border border-line bg-canvas p-8 text-center shadow-lift">
      <span className={cn("mx-auto grid h-14 w-14 place-items-center rounded-2xl", lockdown.away === "start" ? "bg-orange-500/10 text-orange-500" : "bg-red-500/10 text-red-500")}>
        {lockdown.away === "start" ? <Lock className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
      </span>
      <h2 id="lockdown-title" className="mt-5 text-2xl font-extrabold text-ink">{lockdown.away === "start"
        ? t("Imtihon rejimi", "Exam mode")
        : t("Ogohlantirish", "Warning")}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{lockdown.away === "start"
        ? t("To‘liq ekranda davom eting.", "Continue in fullscreen.")
        : lockdown.away === "fullscreen"
          ? t("To‘liq ekrandan chiqdingiz.", "You left fullscreen.")
          : lockdown.away === "screenshot"
            ? t("Skrinshot olish taqiqlangan. Urinish qayd etildi va examinerga ko‘rinadi.", "Screenshots are not allowed. The attempt was recorded and the examiner can see it.")
            : t("Boshqa oynaga o‘tdingiz.", "You switched to another window.")}</p>
      {lockdown.violations > 0 && <div className="mt-5" aria-label={`${lockdown.violations} / ${maxViolations}`}>
        <div className="flex justify-center gap-2">{Array.from({ length: maxViolations }, (_, index) => <i key={index} className={cn("h-2.5 w-10 rounded-full", index < lockdown.violations ? "bg-red-500" : "bg-surface ring-1 ring-line")} />)}</div>
        <p className="mt-2 text-xs font-bold text-red-500">{violationsLeft > 0
          ? t(`${lockdown.violations}/${maxViolations} ogohlantirish`, `${lockdown.violations}/${maxViolations} warnings`)
          : t("Imtihon yakunlanmoqda…", "Ending the exam…")}</p>
      </div>}
      {lockdown.away === "start" && <BrowserAdvice className="mt-5" />}
      <Button className="mt-6 w-full" disabled={violationsLeft === 0} onClick={() => { lockdown.resume().catch(() => {}); }}>
        <Maximize className="h-4 w-4" />
        {t("Davom etish", "Continue")}
      </Button>
      <button type="button" onClick={leaveExam} className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-muted transition hover:text-ink">
        <LogOut className="h-4 w-4" />{proctored ? t("Chiqish", "Leave") : t("Saqlab chiqish", "Save & exit")}
      </button>
      <p className="mt-2 text-xs text-muted">{t("Qolgan vaqt", "Time left")}: <b className="font-mono text-ink">{time}</b></p>
    </div>
  </div>;
  // Screenshot protection: the exam is painted over the moment Win/Cmd is
  // pressed or the window loses focus, so a capture shows only this screen.
  const protection = examMode && lockdown.shield && !leaving && <div aria-hidden="true" className="exam-shield fixed inset-0 z-[72] grid place-items-center bg-[#0b1020] p-6 text-center">
    <div><Lock className="mx-auto h-10 w-10 text-orange-500" /><p className="mt-3 text-sm font-bold text-white/80">{t("Imtihon himoyalangan", "Exam protected")}</p></div>
  </div>;
  const lockdownPill = <span
    title={t("Imtihon rejimi", "Exam mode")}
    className={cn("flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold", lockdown.violations ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-surface text-muted")}
  ><Lock className="h-3.5 w-3.5" /><span className={cn(!lockdown.violations && "hidden md:inline")}>{lockdown.violations ? `${lockdown.violations}/${maxViolations}` : t("Imtihon rejimi", "Exam mode")}</span></span>;
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

  if (awaitingStart) {
    const total = scorableQuestions(questions).length;
    const fact = (value: number, label: string) => <div className="rounded-2xl bg-surface px-2 py-3"><p className="text-2xl font-extrabold text-ink">{value}</p><p className="text-xs font-bold text-muted">{label}</p></div>;
    return <>
      {proctorOverlay}
      {timeBanner}
      <div className="exam-screen grid min-h-[100dvh] place-items-center bg-surface p-4">
        <div className="w-full max-w-md rounded-3xl border border-line bg-canvas p-7 text-center shadow-lift sm:p-9">
          <h1 className="text-2xl font-extrabold leading-tight text-ink">{test.title}</h1>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {fact(test.time_limit_minutes, t("daqiqa", "minutes"))}
            {fact(total, t("savol", "questions"))}
            {fact(exercises.length, t("mashq", "exercises"))}
          </div>
          <ul className="mt-6 space-y-3 text-left text-sm font-semibold text-ink">
            {examMode && <li className="flex items-center gap-3"><Maximize className="h-4 w-4 shrink-0 text-brand" />{t("To‘liq ekranda o‘tadi.", "Runs in fullscreen.")}</li>}
            {examMode && <li className="flex items-center gap-3"><ShieldAlert className="h-4 w-4 shrink-0 text-brand" />{t(`Boshqa oynaga o‘tish — ogohlantirish. ${maxViolations} tasida imtihon yakunlanadi.`, `Leaving the exam is a warning. ${maxViolations} end it.`)}</li>}
            <li className="flex items-center gap-3"><Check className="h-4 w-4 shrink-0 text-brand" />{t("Javoblar o‘zi saqlanadi.", "Answers save automatically.")}</li>
          </ul>
          <BrowserAdvice className="mt-6" />
          {error && <p className="mt-5 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
          <Button className="mt-7 w-full" onClick={beginExam} disabled={beginning}><Play className="h-4 w-4" /> {beginning ? t("Tayyorlanmoqda…", "Preparing…") : t("Boshlash", "Start")}</Button>
          <p className="mt-3 text-xs text-muted">{t("Vaqt shu tugmadan keyin boshlanadi.", "The clock starts when you press it.")}</p>
          <button type="button" onClick={() => { setLeaving(true); router.push("/dashboard"); }} className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 px-4 text-sm font-bold text-muted transition hover:text-ink"><ArrowLeft className="h-4 w-4" /> {t("Orqaga", "Back")}</button>
        </div>
      </div>
    </>;
  }

  if (showReview) return <>
    {proctorOverlay}
    {timeBanner}
    {lockdownOverlay}
    {protection}
    {dialog}
    <div className="exam-screen min-h-screen bg-surface p-4 sm:p-8"><div className="mx-auto max-w-5xl rounded-3xl border border-line bg-canvas p-6 shadow-soft sm:p-9">
    <div className="flex items-center justify-between gap-3">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-500/10 text-orange-500"><Check /></span>
      {/* Time keeps running on the review screen — show it here too. */}
      <ExamCountdown base={clockBase} paused={paused}>{(left, text) =>
        <span className={cn("flex items-center gap-2 rounded-xl bg-surface px-3 py-2 font-mono text-sm font-bold", left < 300 ? "text-red-500" : "text-ink")}><Clock3 className="h-4 w-4 text-brand" />{text}</span>}
      </ExamCountdown>
    </div>
    <h1 className="mt-6 text-3xl font-extrabold text-ink">{t("Topshirishga tayyormisiz?", "Ready to submit?")}</h1>
    <p className="mt-3 text-muted">{t(`${answered}/${scoredQuestions.length} ta savolga javob berildi.`, `${answered} of ${scoredQuestions.length} answered.`)}</p>
    <div className="mt-7 space-y-5">{test.sections.map((section) => {
      const sectionExercises = exercises.map((item, index) => ({ item, index })).filter(({ item }) => item.section.id === section.id);
      return <section key={section.id}><h2 className="text-sm font-extrabold text-ink">{section.title}</h2><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sectionExercises.map(({ item, index }) => {
        const itemQuestions = scorableQuestions(item.questions);
        const done = itemQuestions.filter((question) => hasAnswer(answers[question.id])).length;
        const unlocked = exerciseUnlocked(index);
        return <button key={item.id} disabled={!unlocked} onClick={() => { goToExercise(index); setShowReview(false); }} className={cn("rounded-xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-45", done === itemQuestions.length ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10" : "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-500/10")}><span className="flex items-center gap-2 text-sm font-extrabold">{!unlocked && <Lock className="h-3.5 w-3.5" />}{item.title}</span><span className="mt-1 block text-xs">{t(`${done}/${itemQuestions.length} ta javob berildi`, `${done}/${itemQuestions.length} answered`)}</span></button>;
      })}</div></section>;
    })}</div>
    {error && <p className="mt-5 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      {!proctored && <Button variant="danger" onClick={restartAttempt} className="sm:mr-auto"><RotateCcw className="h-4 w-4" /> {t("Boshidan boshlash", "Start over")}</Button>}
      <Button variant="secondary" onClick={() => setShowReview(false)}>{t("Testga qaytish", "Back to test")}</Button>
      <Button onClick={submit}><Send className="h-4 w-4" /> {t("Topshirish", "Submit")}</Button>
    </div>
  </div></div>
  </>;

  return <>
    {dialog}
    {proctorOverlay}
    {timeBanner}
    {lockdownOverlay}
    {protection}
    {/* split: a reading/writing panel is on screen — the page stops scrolling
        and the panel and the questions each scroll on their own. */}
    <div className={cn("exam-screen min-h-[100dvh] bg-surface xl:flex xl:h-[100dvh] xl:flex-col xl:overflow-hidden", split && "flex h-[100dvh] flex-col overflow-hidden")}>
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
      {/* Phone sideways (short:): everything on one thin row so the few
          hundred pixels of height go to the questions. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 short:flex-nowrap short:gap-x-3 short:py-1.5 xl:px-6">
        <div className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:flex-none sm:gap-3 short:flex-1">
          <button
            // A proctored attempt's history entry is the waiting room, which
            // would bounce straight back here — go to the dashboard instead.
            onClick={() => { setLeaving(true); if (proctored || window.history.length <= 1) router.push("/dashboard"); else router.back(); }}
            aria-label={t("Orqaga", "Go back")}
            title={t("Orqaga", "Back")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:bg-surface hover:text-ink"
          ><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold text-ink sm:text-lg">{test.title}</p>
          </div>
          {/* Phones: timer, exam-mode badge and exit sit on the title row so the
              sticky header stays short and the questions get the screen. */}
          <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
            <ExamCountdown base={clockBase} paused={paused} onExpire={() => { if (timerStarted) setShowReview(true); }}>{(left, text) =>
              <span className={cn("flex items-center gap-1 rounded-lg bg-surface px-2 py-1.5 font-mono text-[13px] font-bold", left < 300 ? "text-red-500" : "text-ink")}><Clock3 className="h-3.5 w-3.5 text-brand" />{text}</span>}
            </ExamCountdown>
            {offerFullscreen && <button type="button" onClick={goFullscreen} aria-label={t("To‘liq ekran", "Fullscreen")} title={t("To‘liq ekran", "Fullscreen")} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink active:scale-95"><Maximize className="h-4 w-4" /></button>}
            {examMode && <span title={t("Imtihon rejimi", "Exam mode")} className={cn("flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-bold", lockdown.violations ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-surface text-muted")}><Lock className="h-3.5 w-3.5" />{lockdown.violations ? `${lockdown.violations}/${maxViolations}` : null}</span>}
            {proctored
              ? <span title={t("Examiner nazoratidagi imtihon", "Examiner-proctored exam")} className="grid h-8 w-8 place-items-center rounded-lg bg-teal-500/10 text-teal-700 dark:text-teal-300"><ShieldAlert className="h-4 w-4" /></span>
              : <button type="button" onClick={saveAndExit} aria-label={t("Saqlab chiqish", "Save & exit")} title={t("Saqlab chiqish", "Save & exit")} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink active:scale-95"><LogOut className="h-4 w-4" /></button>}
          </div>
        </div>
        <div className={cn("w-full min-w-0 flex-wrap items-center justify-end gap-2.5 short:w-auto short:flex-none short:flex-nowrap short:gap-2 xl:w-auto",exercise.media?.mime_type.startsWith("audio/") ? "flex" : "hidden sm:flex")}>
          {exercise.media?.mime_type.startsWith("audio/") && <>
            <AudioPlayer className="min-w-0 flex-1 sm:w-[22rem] sm:flex-none sm:shrink-0 short:w-60 short:flex-none md:short:w-[22rem]" src={mediaUrl(exercise.media.url)} autoStartDelay={5000} onPlay={(media) => guardMediaPlay(exercise, media)} onEnded={() => recordMediaPlay(exercise)} />
            {exercise.audio_replay_limit && <span title={t("Qolgan tinglashlar", "Plays left")} className="shrink-0 rounded-lg bg-surface px-2 py-2 text-[10px] font-bold text-muted">{Math.max(0, exercise.audio_replay_limit - (mediaPlays[exercise.id] ?? 0))} {t("ta qoldi", "left")}</span>}
          </>}
          <span className="hidden shrink-0 rounded-xl bg-surface px-2.5 py-2 text-xs font-bold text-muted sm:block">{exerciseAnswered}/{exerciseQuestions.length}</span>
          <span className={cn("hidden shrink-0 text-xs font-semibold xl:block", saveState === "error" ? "text-red-500" : "text-muted")}>{saveState === "saving" ? t("Saqlanmoqda…", "Saving…") : saveState === "saved" ? t("Barcha javoblar saqlandi", "All answers saved") : saveState === "error" ? t("⚠ Saqlanmadi — qayta urinilmoqda…", "⚠ Not saved — retrying…") : t("Avtosaqlash yoqilgan", "Autosave enabled")}</span>
          <ExamCountdown base={clockBase} paused={paused} onExpire={() => { if (timerStarted) setShowReview(true); }}>{(left, text) =>
            <span className={cn("hidden shrink-0 items-center gap-2 rounded-xl bg-surface px-3 py-2 font-mono text-sm font-bold sm:flex", left < 300 ? "text-red-500" : "text-ink")}><Clock3 className="h-4 w-4 text-brand" />{text}</span>}
          </ExamCountdown>
          {offerFullscreen && <button type="button" onClick={goFullscreen} title={t("To‘liq ekran", "Fullscreen")} className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink transition hover:border-brand hover:text-brand sm:flex"><Maximize className="h-4 w-4" /><span className="hidden md:inline">{t("To‘liq ekran", "Fullscreen")}</span></button>}
          {examMode && <span className="hidden sm:contents">{lockdownPill}</span>}
          {proctored
            ? <span title={t("Examiner nazoratidagi imtihon", "Examiner-proctored exam")} className="hidden shrink-0 sm:flex items-center gap-1.5 rounded-xl bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-700 dark:text-teal-300"><ShieldAlert className="h-4 w-4" /><span className="hidden md:inline">{t("Nazoratdagi imtihon", "Proctored")}</span></span>
            : <button
            type="button"
            onClick={saveAndExit}
            title={t("Hammasini saqlab, keyin davom ettirish", "Save everything and continue later")}
            className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink transition hover:border-brand hover:text-brand sm:flex"
          ><LogOut className="h-4 w-4" /><span className="hidden md:inline">{t("Saqlab chiqish", "Save & exit")}</span></button>}
        </div>
      </div>
      <div className="h-1 bg-surface"><div className="h-full bg-brand transition-[width]" style={{ width: `${scoredQuestions.length ? (answered / scoredQuestions.length) * 100 : 0}%` }} /></div>
    </header>

    <div className={cn("p-3 xl:flex xl:min-h-0 xl:flex-1 xl:gap-4 xl:p-4", split && "flex min-h-0 flex-1 flex-col xl:flex-row")}>
      <div
        className={cn("group/side relative hidden h-full shrink-0 xl:block", !sidebarOpen && "xl:-mr-4")}
        onMouseEnter={holdSidebar}
        onMouseLeave={releaseSidebar}
      >
      <div className={cn("h-full overflow-hidden rounded-2xl transition-[width] duration-300 ease-out", sidebarOpen ? "w-60" : "w-0")}>
        <aside
          ref={sidebarScrollRef}
          onScroll={updateSidebarThumb}
          className="no-scrollbar h-full w-60 overflow-y-auto rounded-2xl border border-line bg-canvas p-3"
        >
          <div className="flex items-center justify-between px-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("Mashqlar", "Exercises")}</p>
            <button
              type="button"
              onClick={toggleSidebarPin}
              title={sidebarPinnedOn ? t("Mahkamlashni olish (avto-yig'ish)", "Unpin (auto-collapse on)") : t("Panelni ochiq qoldirish", "Pin panel open")}
              aria-label={sidebarPinnedOn ? t("Mashqlar panelini mahkamlashdan olish", "Unpin exercises panel") : t("Mashqlar panelini ochiq qoldirish", "Pin exercises panel open")}
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-md transition",
                sidebarPinnedOn ? "bg-brand/15 text-brand" : "text-muted hover:bg-orange-500/10 hover:text-brand",
              )}
            >
              {sidebarPinnedOn ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            </button>
          </div>
          {test.sections.map((section) => {
            const sectionExercises = exercises.map((item, index) => ({ item, index })).filter(({ item }) => item.section.id === section.id);
            const sectionQuestions = scorableQuestions(sectionExercises.flatMap(({ item }) => item.questions));
            return <div key={section.id} className="mt-4"><div className="flex items-center justify-between px-2"><p className="text-sm font-extrabold text-ink">{section.title}</p><span className="text-[11px] font-bold text-muted">{sectionQuestions.filter((question) => hasAnswer(answers[question.id])).length}/{sectionQuestions.length}</span></div><div className="mt-2 space-y-1">{sectionExercises.map(({ item, index }) => {
              const itemQuestions = scorableQuestions(item.questions);
              const done = itemQuestions.filter((question) => hasAnswer(answers[question.id])).length;
              const unlocked = exerciseUnlocked(index);
              return <div key={item.id}>
                <button disabled={!unlocked} onClick={() => goToExercise(index)} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40", index === currentExercise ? "bg-brand text-white shadow-md shadow-orange-500/20" : "bg-surface text-ink hover:bg-orange-500/5")}><span className="flex min-w-0 items-center gap-2 truncate pr-2">{!unlocked && <Lock className="h-3 w-3 shrink-0" />}{item.title}</span><span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px]", index === currentExercise ? "bg-white/15 text-white" : done === itemQuestions.length ? "bg-emerald-500/10 text-emerald-600" : "text-muted")}>{done}/{itemQuestions.length}</span></button>
                {/* Question palette: jump to any question, colour = its status. */}
                {index === currentExercise && itemQuestions.length > 0 && <div className="mb-1 mt-1.5 grid grid-cols-6 gap-1 px-0.5">
                  {itemQuestions.map((q) => {
                    const r = exerciseResults[q.id];
                    const checkedQ = q.id in exerciseResults;
                    const answeredQ = hasAnswer(answers[q.id]);
                    const isFlagged = flagged.includes(q.id);
                    return <button
                      key={q.id}
                      title={isFlagged ? t("Belgilangan", "Flagged") : undefined}
                      onClick={() => document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                      className={cn("relative grid h-7 place-items-center rounded-md text-[11px] font-bold transition",
                        checkedQ && r === true ? "bg-emerald-500 text-white"
                          : checkedQ && r === false ? "bg-red-500 text-white"
                            : checkedQ ? "bg-amber-500 text-white"
                              : answeredQ ? "bg-brand text-white"
                                : "bg-surface text-muted hover:bg-orange-500/10")}
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
        aria-label={sidebarOpen ? t("Mashqlar panelini yig'ish", "Collapse exercises panel") : t("Mashqlar panelini ochish", "Open exercises panel")}
        className={cn(
          "absolute top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-brand text-white shadow-lg shadow-orange-500/30 transition-transform duration-300 ease-out hover:scale-105",
          sidebarOpen ? "-right-3" : "left-1",
        )}
      >
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      </div>

      <main className={cn("min-w-0 xl:flex xl:h-full xl:flex-1 xl:flex-col xl:overflow-hidden", split && "flex min-h-0 flex-1 flex-col")}>
        <div className={cn("mb-3 flex shrink-0 gap-2 overflow-x-auto pb-2 xl:hidden", split && "mb-2 pb-1")}>{exercises.map((item, index) => { const unlocked = exerciseUnlocked(index); return <button key={item.id} disabled={!unlocked} onClick={() => goToExercise(index)} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40", index === currentExercise ? "bg-brand text-white" : "border border-line bg-canvas text-muted")}>{!unlocked && <Lock className="h-3 w-3" />}{item.title}</button>; })}</div>

        {exercise.media && !exercise.media.mime_type.startsWith("audio/") && <div className="mb-2.5 shrink-0 rounded-2xl border border-line bg-canvas p-2.5">
          {exercise.media.mime_type.startsWith("image/") ? <img className="max-h-72 w-full rounded-xl object-contain" src={mediaUrl(exercise.media.url)} alt={exercise.media.file_name} /> : <>
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Headphones className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-wide text-muted">{t("Listening videosi", "Listening video")}</p><p className="truncate text-xs font-extrabold text-ink">{exercise.media.file_name}</p></div>
              {exercise.audio_replay_limit && <span className="shrink-0 rounded-lg bg-surface px-2 py-1 text-[10px] font-bold text-muted">{t(`${Math.max(0, exercise.audio_replay_limit - (mediaPlays[exercise.id] ?? 0))} marta qoldi`, `${Math.max(0, exercise.audio_replay_limit - (mediaPlays[exercise.id] ?? 0))} plays left`)}</span>}
            </div>
            <video className="max-h-48 w-full rounded-xl bg-black" controls preload="metadata" src={mediaUrl(exercise.media.url)} onPlay={(event) => guardMediaPlay(exercise, event.currentTarget)} onEnded={() => recordMediaPlay(exercise)} />
          </>}
        </div>}
        {/* When a reading passage is present the screen splits: passage on the
            left (its own scroll), questions on the right. A draggable divider
            between them lets the student give either side more room. On phones
            and tablets the same split runs top (passage) / bottom (questions). */}
        <div ref={splitRef} className={cn("min-h-0 xl:flex xl:min-h-0 xl:flex-1 xl:overflow-hidden", split && "flex flex-1 flex-col overflow-hidden xl:flex-row")}>
        {passageText && <>
        {/* Phones: the passage takes passageHeight% of what's left after the
            14px divider; the questions take the rest — so 30% really is 30%. */}
        <aside ref={passageScrollRef} style={{ "--pw": `${passageWidth}%`, "--pf": passageHeight / 100 } as CSSProperties} className="passage-panel min-h-0 min-w-0 flex-none basis-[calc((100%-14px)*var(--pf))] overflow-y-auto overscroll-contain rounded-3xl border border-line bg-canvas p-4 shadow-sm sm:p-5 xl:basis-auto xl:w-[var(--pw)]">
          <div className="mb-3 flex items-center gap-2 text-brand">
            <PanelIcon className="h-4 w-4" /><p className="text-xs font-bold uppercase tracking-wider">{panelLabel}</p>
            {/* Text zoom: − / current / + */}
            <div className="ml-auto flex items-center gap-1">
              <button type="button" aria-label={t("Matnni kichraytirish", "Smaller text")} title={t("Matnni kichraytirish", "Smaller text")} disabled={passageZoom <= 12}
                onClick={() => setPassageZoom((size) => Math.max(12, size - 1.5))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface text-sm font-extrabold text-muted transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40">−</button>
              <button type="button" title={t("Matn o'lchamini tiklash", "Reset text size")} onClick={() => setPassageZoom(15)}
                className="min-w-10 rounded-lg px-1 py-1 text-[10px] font-bold text-muted transition hover:text-ink">{Math.round((passageZoom / 15) * 100)}%</button>
              <button type="button" aria-label={t("Matnni kattalashtirish", "Larger text")} title={t("Matnni kattalashtirish", "Larger text")} disabled={passageZoom >= 27}
                onClick={() => setPassageZoom((size) => Math.min(27, size + 1.5))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface text-sm font-extrabold text-muted transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40">+</button>
            </div>
          </div>
          {passageHtml
            ? <div className="passage-content text-ink" style={{ fontSize: `${passageZoom}px`, lineHeight: 1.85 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(passageHtml) }} />
            : <div className="text-ink" style={{ fontSize: `${passageZoom}px`, lineHeight: 1.85 }}>{renderInstructionBlocks(passagePlain, false)}</div>}
        </aside>
        {/* Phones/tablets: grab the bar and drag up/down (30–70%). */}
        <div
          ref={splitHandleRef}
          role="separator" aria-orientation="horizontal" tabIndex={0}
          aria-label={t("Matn va savollar orasidagi chegara", "Divider between the text and the questions")}
          aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(passageHeight)}
          onPointerDown={(event) => startSplitDrag(event, "y")}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              setPassageHeight((value) => Math.min(70, Math.max(30, value + (event.key === "ArrowUp" ? -5 : 5))));
            }
          }}
          title={t("Tortib o'lchamni o'zgartiring", "Drag to resize")}
          // A slim 4px bar in a 14px gap; the invisible ::before keeps a
          // finger-sized (30px) grab area without taking that much screen.
          className="group relative z-10 flex h-3.5 shrink-0 cursor-row-resize touch-none select-none items-center justify-center outline-none before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] xl:hidden"
        >
          <div className="h-1 w-10 rounded-full bg-current text-muted opacity-50 transition-all group-active:w-14 group-active:text-brand group-active:opacity-100 group-focus-visible:text-brand group-focus-visible:opacity-100" />
        </div>
        <div onPointerDown={(event) => startSplitDrag(event, "x")} title={t("O'lchamni o'zgartirish uchun torting", "Drag to resize")} className="group hidden shrink-0 cursor-col-resize touch-none items-center justify-center px-2 xl:flex">
          <div className="h-16 w-1.5 rounded-full bg-line transition group-hover:bg-brand" />
        </div>
        </>}

        <section className={cn("exam-questions min-h-0 min-w-0 rounded-3xl border border-line bg-canvas p-4 shadow-sm sm:p-5 xl:flex xl:flex-1 xl:flex-col xl:overflow-hidden", split && "flex flex-1 flex-col overflow-hidden p-3 sm:p-4 xl:p-5")}>
          <div ref={questionsScrollRef} className={cn("min-h-0 gap-4 xl:flex-1 xl:overflow-y-auto xl:pr-2", bankOptions.length && "exam-with-bank grid", split && "flex-1 overflow-y-auto overscroll-contain")}>
            <div className={cn("mx-auto w-full space-y-3", isGapMatch ? "max-w-6xl" : "max-w-3xl")}>
            {/* Exercise heading lives with the questions: number + full rubric
                in a readable size (the sticky header only keeps the test title). */}
            <div className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-extrabold uppercase tracking-wider text-brand">{t(`${currentExercise + 1}-mashq`, `Exercise ${currentExercise + 1}`)} <span className="font-bold text-muted">/ {exercises.length}</span></p>
                <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-muted">{t(`Jami ${answered}/${scoredQuestions.length}`, `${answered}/${scoredQuestions.length} total`)}</span>
              </div>
              {headerInstructions && (
                /^[^\n]*\n\s*[-•*]\s+/.test(headerInstructions)
                  ? <div className="mt-1.5">{renderInstructionBlocks(headerInstructions, true)}</div>
                  : <h2 className="mt-1.5 text-lg font-extrabold leading-8 text-ink sm:text-[21px] sm:leading-9">{headerInstructions}</h2>
              )}
            </div>
            {!!exercise.interaction?.word_box?.length && <div className="mb-4 rounded-2xl border border-line bg-surface p-4">
              <p className="mb-2.5 text-xs font-extrabold uppercase tracking-wider text-muted">{t("So'zlar qutisi", "Word box")}</p>
              <div className="flex flex-wrap gap-2">
                {exercise.interaction.word_box.map((word, index) => <span
                  key={`${word}-${index}`}
                  className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm font-bold text-ink"
                >{word}</span>)}
              </div>
            </div>}
            <fieldset disabled={exerciseChecked} className="m-0 min-w-0 space-y-3 border-0 p-0">
            {exercise.interaction?.kind === "cloze_passage" ? renderClozePassage(exercise)
              : isGapMatch ? (
                <GapMatch
                  exercise={exercise} answers={answers} exerciseResults={exerciseResults}
                  gapPick={gapPick} setGapPick={setGapPick} setAnswer={setAnswer}
                />
              )
              : exercise.questions.map((question) => {
              const number = questionNumbers.get(question.id);
              const result = exerciseResults[question.id];
              const checked = question.id in exerciseResults;
              return <article key={question.id} id={`q-${question.id}`} className={cn(
                "group/card scroll-mt-4 rounded-2xl border p-4 transition duration-150 sm:p-5",
                result === true ? "border-emerald-300 bg-emerald-500/[.04]"
                  : result === false ? "border-red-300 bg-red-500/[.04]"
                    : checked ? "border-amber-300 bg-amber-500/[.04]"
                    : hasAnswer(answers[question.id]) ? "border-orange-200 bg-orange-500/[.025]"
                    : "border-line bg-canvas hover:border-orange-200/70 hover:shadow-sm",
              )}>
              <div className="flex items-start gap-2.5 sm:gap-3.5">
                <span className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-extrabold transition-colors sm:h-9 sm:w-9 sm:rounded-xl",
                  result === true ? "bg-emerald-500 text-white" : result === false ? "bg-red-500 text-white"
                    : checked ? "bg-amber-500 text-white"
                    : hasAnswer(answers[question.id]) ? "bg-brand text-white"
                    : question.is_example ? "bg-sky-500/10 text-sky-600" : "bg-surface text-muted",
                )}>{result === true ? <CheckCircle2 className="h-5 w-5" /> : result === false ? <XCircle className="h-5 w-5" /> : checked ? <Clock3 className="h-5 w-5" /> : question.is_example ? "e.g" : number}</span>
                <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3">{renderPrompt(exercise, question)}{!question.is_example && <button aria-label={t(`${number}-savolni belgilash`, `Flag question ${number}`)} title={t("Takrorlash uchun belgilash", "Flag for review")} onClick={() => toggleFlag(question.id)} className={cn(
                  "shrink-0 rounded-lg p-2 transition",
                  flagged.includes(question.id)
                    ? "bg-orange-500/10 text-orange-500"
                    : "text-muted/50 hover:bg-orange-500/10 hover:text-orange-500 sm:[@media(hover:hover)]:opacity-0 sm:group-hover/card:opacity-100",
                )}><Bookmark className={cn("h-4 w-4", flagged.includes(question.id) && "fill-current")} /></button>}</div>{question.is_example && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-600"><CheckCircle2 className="h-3.5 w-3.5" /> {t("Namuna — baholanmaydi", "Example — not scored")}</p>}{renderAnswer(exercise, question)}{result === false && correctAnswers[question.id] && <p className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300"><Check className="h-3.5 w-3.5" /> {t("To‘g‘ri javob", "Correct answer")}: {interactionOptions(exercise).find((option) => option.value === correctAnswers[question.id])?.label ?? correctAnswers[question.id]}</p>}{checked && result === null && <p className="mt-3 text-xs font-bold text-brand">🤖 {t("Topshirgach AI baholaydi.", "AI grades this after you submit.")}</p>}</div>
              </div>
            </article>;
          })}
            </fieldset>
              {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
              <div className="mt-2 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" disabled={currentExercise === 0} onClick={() => goToExercise(currentExercise - 1)}><ChevronLeft className="h-4 w-4" /> {t("Oldingi", "Previous")}</Button>
                {exerciseChecked
                  ? <span className="order-first inline-flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-600 sm:order-none"><CheckCircle2 className="h-4 w-4" /> {t("Mashq yakunlandi", "Exercise finished")}</span>
                  : firstUnanswered
                    ? <button type="button" onClick={() => scrollToQuestion(firstUnanswered.id)} className="order-first text-center text-xs font-bold text-brand underline-offset-4 hover:underline sm:order-none">{t(`${exerciseQuestions.length - exerciseAnswered} ta javobsiz — ko‘rsatish`, `${exerciseQuestions.length - exerciseAnswered} unanswered — show`)}</button>
                    : <span className="order-first text-center text-xs font-bold text-muted sm:order-none">{t(`${exerciseAnswered}/${exerciseQuestions.length} ta javob`, `${exerciseAnswered}/${exerciseQuestions.length} answered`)}</span>}
                {!checkedTaskIds.includes(exercise.id)
                  ? <Button variant="secondary" onClick={() => checkExercise(exercise)} disabled={checkingExercise}><Check className="h-4 w-4" /> {checkingExercise ? t("Saqlanmoqda…", "Saving…") : t("Mashqni yakunlash", "Finish exercise")}</Button>
                  : currentExercise < exercises.length - 1
                    ? <Button onClick={() => goToExercise(currentExercise + 1)}>{t("Keyingi mashq", "Next exercise")} <ChevronRight className="h-4 w-4" /></Button>
                    : <Button onClick={() => setShowReview(true)}>{t("Topshirishga o‘tish", "Review & submit")} <ChevronRight className="h-4 w-4" /></Button>}
              </div>
            </div>

            {bankOptions.length > 0 && <aside className="exam-word-bank order-first mb-5 rounded-2xl border border-orange-200 bg-orange-500/[.035] p-4">
              <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-brand">{exercise.interaction?.kind === "matching" ? t("Gapiruvchilar", "Speakers") : t("So'zlar banki", "Word bank")}</p><p className="mt-1 text-[11px] leading-4 text-muted">{reusableOptions ? t("Qayta ishlatsa bo‘ladi.", "Reusable.") : t("Har biri bir marta.", "Use each once.")}</p></div><GripVertical className="h-5 w-5 text-orange-300" /></div>
              <div className="exam-bank-options mt-4 flex flex-wrap gap-2">{bankOptions.map((option) => {
                const used = !reusableOptions && usedOptions.has(option.value);
                const selected = selectedToken === option.value;
                return <button
                  type="button"
                  key={option.value}
                  draggable={!used && !exerciseChecked}
                  disabled={used || exerciseChecked}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", option.value);
                    setSelectedToken(option.value);
                  }}
                  onClick={() => setSelectedToken(selected ? null : option.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border bg-canvas px-3 py-2 text-left text-sm font-bold transition",
                    selected ? "border-brand text-brand ring-2 ring-orange-500/10" : "border-line text-ink hover:border-orange-300",
                    used && "cursor-not-allowed text-muted line-through opacity-45",
                  )}
                ><GripVertical className="h-3.5 w-3.5 shrink-0 text-muted" /><span>{option.label}</span></button>;
              })}</div>
              {selectedToken && <p className="mt-3 rounded-lg bg-brand px-3 py-2 text-[11px] font-bold text-white">{t("Tanlandi", "Selected")}: {bankOptions.find((option) => option.value === selectedToken)?.label}</p>}
              {!exerciseChecked && <button type="button" onClick={() => {
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
              }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-muted hover:bg-canvas hover:text-ink"><RotateCcw className="h-3.5 w-3.5" /> {t("Mashqni tozalash", "Clear exercise")}</button>}
            </aside>}
          </div>
        </section>
        </div>
      </main>
    </div>
  </div>
  </>;
}
