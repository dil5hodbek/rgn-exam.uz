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

export type LockdownAway = null | "start" | "fullscreen" | "hidden" | "blur";
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

/** Blocked shortcuts: copy/paste/cut, print, save, view source, find, reload, new tab/window, dev tools. */
function blockedCombo(event: KeyboardEvent) {
  const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
  if (event.key === "F12" || event.key === "F5" || event.key === "PrintScreen") return true;
  if (mod && ["c", "v", "x", "p", "s", "u", "f", "r", "g", "o", "n", "t", "w"].includes(key)) return true;
  if (mod && event.shiftKey && ["i", "j", "c", "k"].includes(key)) return true;
  if (event.metaKey && event.altKey && ["i", "j", "c", "u"].includes(key)) return true;
  return false;
}

export function useExamLockdown({ active, initialViolations, onViolation }: {
  active: boolean;
  initialViolations: number;
  onViolation: (kind: ViolationKind, localCount: number) => void;
}) {
  const [away, setAway] = useState<LockdownAway>(null);
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
    fullscreenOk.current = fullscreenSupported();
    // A fresh page load is never fullscreen — coming back needs a click (not a violation).
    if (fullscreenOk.current && !isFullscreen()) { awayRef.current = "start"; setAway("start"); }

    const onFullscreen = () => { if (fullscreenOk.current && !isFullscreen()) mark("fullscreen"); };
    const onVisibility = () => { if (document.hidden) mark("hidden"); };
    const onBlur = () => { setTimeout(() => { if (!document.hasFocus()) mark("blur"); }, 150); };
    const stop = (event: Event) => { event.preventDefault(); };
    const onKey = (event: KeyboardEvent) => { if (blockedCombo(event)) { event.preventDefault(); event.stopPropagation(); } };
    const guarded = ["contextmenu", "copy", "cut", "paste"];

    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    for (const name of guarded) document.addEventListener(name, stop, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("beforeprint", stop);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("webkitfullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      for (const name of guarded) document.removeEventListener(name, stop, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("beforeprint", stop);
      exitFullscreen();
      awayRef.current = null;
      setAway(null);
    };
  }, [active, mark]);

  /** "Back to the exam" — browsers only allow fullscreen from a click. */
  const resume = useCallback(async () => {
    // If the browser refuses fullscreen, don't trap the student: carry on
    // without it (switching apps is still detected and counted).
    if (fullscreenOk.current && !(await enterFullscreen())) fullscreenOk.current = false;
    awayRef.current = null;
    setAway(null);
  }, []);

  return { away, violations, resume, syncViolations, fullscreen: fullscreenOk };
}
