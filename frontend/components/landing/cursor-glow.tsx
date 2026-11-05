"use client";

import { useEffect, useRef } from "react";

export function CursorGlow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const enabled = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    let frame = 0;
    const cells = new Map<string, { x: number; y: number; time: number; strength: number }>();
    const radius = 18;
    const height = Math.sqrt(3) * radius;
    let lastCell = "";
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      cells.clear();
      lastCell = "";
    };
    const clear = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      cells.clear();
      lastCell = "";
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    const draw = (now: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const [key, cell] of cells) {
        const age = now - cell.time;
        if (age >= 650) { cells.delete(key); continue; }
        const fade = Math.sin(Math.PI * age / 650) * cell.strength;
        ctx.beginPath();
        for (let index = 0; index < 6; index++) {
          const angle = Math.PI / 3 * index;
          const x = cell.x + Math.cos(angle) * (radius - 3);
          const y = cell.y + Math.sin(angle) * (radius - 3);
          if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(255, 117, 42, ${fade * .055})`;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(247, 108, 37, ${fade * .36})`;
        ctx.stroke();
      }
      frame = cells.size ? requestAnimationFrame(draw) : 0;
    };
    const move = (event: PointerEvent) => {
      if (!enabled.matches || event.pointerType !== "mouse") { clear(); return; }
      const column = Math.round(event.clientX / (radius * 1.5));
      const row = Math.round((event.clientY - (column % 2) * height / 2) / height);
      const key = `${column}:${row}`;
      if (key === lastCell) return;
      lastCell = key;
      const now = performance.now();
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const c = column + dc, r = row + dr;
          const x = c * radius * 1.5;
          const y = r * height + (c % 2) * height / 2;
          const distance = Math.hypot(x - event.clientX, y - event.clientY);
          if (distance > 40) continue;
          cells.set(`${c}:${r}`, { x, y, time: now, strength: Math.max(.2, 1 - distance / 55) });
        }
      }
      if (!frame) frame = requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("blur", clear);
    document.documentElement.addEventListener("pointerleave", clear);
    enabled.addEventListener("change", clear);
    return () => {
      clear();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", clear);
      document.documentElement.removeEventListener("pointerleave", clear);
      enabled.removeEventListener("change", clear);
    };
  }, []);
  return <canvas ref={ref} className="lp-cursor-trail" aria-hidden="true" />;
}
