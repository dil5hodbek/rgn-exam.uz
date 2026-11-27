"use client";
import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn, formatDuration } from "@/lib/utils";

export const DEFAULT_EXAM_MINUTES = 60;
export const MIN_EXAM_MINUTES = 5;
export const MAX_EXAM_MINUTES = 300;
const PRESETS = [30, 45, 60, 90, 120];

/** Exam length: −/+ in 5-minute steps, a typed value, or a one-tap preset. */
export function DurationPicker({ value, onChange, min = MIN_EXAM_MINUTES, max = MAX_EXAM_MINUTES, presets = PRESETS, id }: {
  value: number; onChange: (minutes: number) => void; min?: number; max?: number; presets?: number[]; id?: string;
}) {
  const { lang, t } = useLang();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (minutes: number) => Math.min(max, Math.max(min, Math.round(minutes)));
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    const next = Number.isFinite(parsed) ? clamp(parsed) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  // Steps land on multiples of 5 (62 → 65 / 60) so the value stays tidy.
  const step = (direction: 1 | -1) => onChange(clamp(direction > 0 ? Math.floor(value / 5) * 5 + 5 : Math.ceil(value / 5) * 5 - 5));
  const stepButton = "grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line bg-canvas text-ink transition hover:bg-surface active:scale-95 disabled:opacity-35 disabled:active:scale-100";

  return <div>
    <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-2">
      <button type="button" className={stepButton} aria-label={t("5 daqiqa kamaytirish", "5 minutes less")} disabled={value <= min} onClick={() => step(-1)}><Minus className="h-5 w-5" /></button>
      <label className="min-w-0 flex-1 text-center">
        <span className="flex items-baseline justify-center gap-1.5">
          <input
            id={id}
            inputMode="numeric"
            aria-label={t("Daqiqa", "Minutes")}
            value={draft}
            onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={commit}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}
            className="w-[3.2ch] bg-transparent text-right text-4xl font-extrabold tabular-nums tracking-tight text-ink outline-none focus:text-teal-700 dark:focus:text-teal-300"
          />
          <span className="text-sm font-bold text-muted">{t("daq", "min")}</span>
        </span>
        <span className="block text-xs font-semibold text-muted">{value >= 60 ? formatDuration(value * 60, lang) : t("Vaqt", "Length")}</span>
      </label>
      <button type="button" className={stepButton} aria-label={t("5 daqiqa qo‘shish", "5 minutes more")} disabled={value >= max} onClick={() => step(1)}><Plus className="h-5 w-5" /></button>
    </div>
    <div className="mt-2 grid grid-cols-5 gap-1.5">{presets.map((minutes) => {
      const blocked = minutes < min || minutes > max;
      return <button key={minutes} type="button" disabled={blocked} onClick={() => onChange(minutes)} className={cn(
        "rounded-xl border py-2 text-sm font-bold tabular-nums transition disabled:cursor-not-allowed disabled:opacity-35",
        value === minutes ? "border-teal-500 bg-teal-500/10 text-teal-700 dark:text-teal-300" : "border-line text-ink hover:bg-surface",
      )}>{minutes}</button>;
    })}</div>
  </div>;
}
