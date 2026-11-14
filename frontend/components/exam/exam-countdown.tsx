"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Time left at the moment `at` (ms since epoch). The exam screen moves this
 * anchor only on load, restart, pause/resume and server corrections. */
export type ClockBase = { remaining: number; at: number };

export function timeLeft(base: ClockBase, paused: boolean, now = Date.now()) {
  if (!base.at) return Math.max(0, Math.round(base.remaining));
  return Math.max(0, Math.round(base.remaining - (paused ? 0 : (now - base.at) / 1000)));
}

export function formatClock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The ticking exam clock. Only this tiny component re-renders every second —
 * previously the whole exam screen (every exercise, input and panel) did,
 * which made typing feel sticky on long tests and slower devices.
 */
export function ExamCountdown({ base, paused, onExpire, children }: {
  base: ClockBase;
  paused: boolean;
  onExpire?: () => void;
  children?: (left: number, text: string) => ReactNode;
}) {
  const [left, setLeft] = useState(() => timeLeft(base, paused));
  const expire = useRef(onExpire);
  expire.current = onExpire;
  const fired = useRef(false);

  useEffect(() => {
    const update = () => setLeft(timeLeft(base, paused));
    update();
    if (paused || !base.at) return;
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [base, paused]);

  useEffect(() => {
    if (left > 0) { fired.current = false; return; }
    if (base.at && !fired.current) {
      fired.current = true;
      expire.current?.();
    }
  }, [left, base.at]);

  const text = formatClock(left);
  return <>{children ? children(left, text) : text}</>;
}
