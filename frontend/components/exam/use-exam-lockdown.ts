"use client";
/**
 * Exam mode (adapted from milliyimtihon's useLockdown):
 *  - the browser goes fullscreen when the exam starts (Chrome also locks Esc:
 *    it has to be held down to leave);
 *  - leaving fullscreen or switching to another tab/window/app counts as one
 *    violation and covers the exam until the student comes back;
 *  - copy/paste, the context menu, printing and dev-tools shortcuts are off.
 * Drag-and-drop stays on — several exercise types are built on it.
 * A browser cannot fully block Alt+Tab / Cmd+Tab; they are detected and counted.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type LockdownAway = null | "start" | "fullscreen" | "hidden" | "blur" | "screenshot";

/** System screenshot shortcuts that reach the page: PrintScreen (Windows
 *  sends it on key-up), Win+Shift+S, and macOS Cmd+Shift+3/4/5/6. */
export function screenshotCombo(event: KeyboardEvent) {
  if (event.key === "PrintScreen" || event.code === "PrintScreen") return true;
  return event.metaKey && event.shiftKey && ["Digit3", "Digit4", "Digit5", "Digit6", "KeyS"].includes(event.code);
}
export type ViolationKind = Exclude<LockdownAway, null | "start">;

type Doc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
type Kb = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

const doc = () => document as Doc;
// iPhone Safari and most in-app browsers (Telegram, Instagram) cannot go fullscreen.
export const fullscreenSupported = () => typeof document !== "undefined"
  && (document.fullscreenEnabled ?? (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled ?? true) !== false
  && !!(document.documentElement.requestFullscreen || (document.documentElement as El).webkitRequestFullscreen);
const isFullscreen = () => !!(doc().fullscreenElement || doc().webkitFullscreenElement);
const keyboard = () => (navigator as Navigator & { keyboard?: Kb }).keyboard;

export async function enterFullscreen() {
  const el = document.documentElement as El;
  try {
    // Some in-app browsers neither grant nor refuse the request — treat 1.5s of silence as a refusal.
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fullscreen timeout")), 1500));
    // Old Safari (webkit) returns no promise — give it a moment to switch.
    const request = el.requestFullscreen
      ? el.requestFullscreen({ navigationUI: "hide" })
      : (el.webkitRequestFullscreen?.(), new Promise((resolve) => setTimeout(resolve, 400)));
    if (!isFullscreen()) await Promise.race([request, timeout]);
    if (!isFullscreen()) return false;
    await keyboard()?.lock?.(["Escape"]).catch(() => {});
    return true;
  } catch { return false; }
}

export function exitFullscreen() {
  try { keyboard()?.unlock?.(); } catch { /* not supported */ }
  if (isFullscreen()) (doc().exitFullscreen ? doc().exitFullscreen() : doc().webkitExitFullscreen?.())?.catch?.(() => {});
}

/** null until mounted (SSR), then whether the page is fullscreen right now. */
export function useFullscreenState() {
  const [state, setState] = useState<{ supported: boolean; on: boolean } | null>(null);
  useEffect(() => {
    const update = () => setState({ supported: fullscreenSupported(), on: isFullscreen() });
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);
  return state;
}

/** Blocked shortcuts: copy/paste/cut, print, save, view source, find, reload, new tab/window, dev tools. */
function blockedCombo(event: KeyboardEvent) {
  const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
  if (event.key === "F12" || event.key === "F5" || event.key === "PrintScreen") return true;
  if (mod && ["c", "v", "x", "p", "s", "u", "f", "r", "g", "o", "n", "t", "w"].includes(key)) return true;
  if (mod && event.shiftKey && ["i", "j", "c", "k"].includes(key)) return true;
  if (event.metaKey && event.altKey && ["i", "j", "c", "u"].includes(key)) return true;
  return false;
}

export function useExamLockdown({ active, initialViolations, onViolation, fullscreenRefused = false }: {
  active: boolean;
  initialViolations: number;
  onViolation: (kind: ViolationKind, localCount: number) => void;
  /** The browser already refused fullscreen on "Start" — don't ask again. */
  fullscreenRefused?: boolean;
}) {
  const [away, setAway] = useState<LockdownAway>(null);
  // Shield: the exam is painted over the moment a screenshot may be coming
  // (Win/Cmd held, window lost focus) — the capture then shows a blank screen.
  const [shield, setShield] = useState(false);
  const [violations, setViolations] = useState(initialViolations);
  const awayRef = useRef<LockdownAway>(null);
  const callback = useRef(onViolation);
  callback.current = onViolation;
  const count = useRef(initialViolations);
  const fullscreenOk = useRef(false);

  // The server's count wins (it survives refreshes and other tabs).
  const syncViolations = useCallback((value: number) => {
    count.current = Math.max(count.current, value);
    setViolations(count.current);
  }, []);
  useEffect(() => { syncViolations(initialViolations); }, [initialViolations, syncViolations]);

  const mark = useCallback((reason: ViolationKind) => {
    if (awayRef.current && awayRef.current !== "start") return; // one trip away = one violation
    awayRef.current = reason;
    setAway(reason);
    count.current += 1;
    setViolations(count.current);
    callback.current(reason, count.current);
  }, []);

  useEffect(() => {
    if (!active) return;
    fullscreenOk.current = fullscreenSupported() && !fullscreenRefused;
    // A fresh page load is never fullscreen — coming back needs a click (not a violation).
    if (fullscreenOk.current && !isFullscreen()) { awayRef.current = "start"; setAway("start"); }

    let unshield: ReturnType<typeof setTimeout> | undefined;
    const raiseShield = () => { if (unshield) clearTimeout(unshield); setShield(true); };
    const lowerShield = (delay = 0) => { if (unshield) clearTimeout(unshield); unshield = setTimeout(() => setShield(false), delay); };
    const onFullscreen = () => { if (fullscreenOk.current && !isFullscreen()) mark("fullscreen"); };
    const onVisibility = () => { if (document.hidden) { raiseShield(); mark("hidden"); } };
    const onBlur = () => { raiseShield(); setTimeout(() => { if (!document.hasFocus()) mark("blur"); }, 150); };
    const onFocus = () => lowerShield(150);
    const stop = (event: Event) => { event.preventDefault(); };
    const onKey = (event: KeyboardEvent) => {
      // Win / Cmd starts every desktop screenshot shortcut: hide the exam first.
      if (event.key === "Meta" || event.key === "OS") raiseShield();
      if (screenshotCombo(event)) { event.preventDefault(); event.stopPropagation(); raiseShield(); mark("screenshot"); return; }
      if (blockedCombo(event)) { event.preventDefault(); event.stopPropagation(); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // Windows delivers PrintScreen only on key-up — record it then.
      if (screenshotCombo(event)) { raiseShield(); mark("screenshot"); lowerShield(800); return; }
      if (event.key === "Meta" || event.key === "OS") lowerShield(400);
    };
    const guarded = ["contextmenu", "copy", "cut", "paste"];

    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    for (const name of guarded) document.addEventListener(name, stop, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("beforeprint", stop);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("webkitfullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      for (const name of guarded) document.removeEventListener(name, stop, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("beforeprint", stop);
      if (unshield) clearTimeout(unshield);
      exitFullscreen();
      awayRef.current = null;
      setAway(null);
      setShield(false);
    };
  }, [active, mark, fullscreenRefused]);

  // Phones: keep the screen awake during the exam. Without this a phone that
  // auto-locks while the student reads a long passage hides the page, which
  // would count as leaving the exam. Re-acquired whenever the page is shown
  // again (the browser drops the lock when the page is hidden).
  useEffect(() => {
    if (!active) return;
    type Sentinel = { release: () => Promise<void> };
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } }).wakeLock;
    if (!wakeLock) return;
    let sentinel: Sentinel | null = null;
    let stopped = false;
    const acquire = () => {
      if (stopped || document.hidden) return;
      wakeLock.request("screen").then((lock) => {
        if (stopped) { lock.release().catch(() => {}); return; }
        sentinel = lock;
      }).catch(() => { /* battery saver or unsupported — fine */ });
    };
    const onVisible = () => { if (!document.hidden) acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
    };
  }, [active]);

  /** "Back to the exam" — browsers only allow fullscreen from a click. */
  const resume = useCallback(async () => {
    // If the browser refuses fullscreen, don't trap the student: carry on
    // without it (switching apps is still detected and counted).
    if (fullscreenOk.current && !(await enterFullscreen())) fullscreenOk.current = false;
    awayRef.current = null;
    setAway(null);
  }, []);

  return { away, violations, resume, syncViolations, fullscreen: fullscreenOk, shield };
}
