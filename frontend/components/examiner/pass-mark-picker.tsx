"use client";
import { Minus, Plus } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PRESETS = [50, 60, 70, 80, 90];

/** Pass mark, 0–100%: −/+ in 5% steps or a one-tap preset, with a meter. */
export function PassMarkPicker({ value, onChange, original }: { value: number; onChange: (percent: number) => void; original?: number }) {
  const { t } = useLang();
  const clamp = (percent: number) => Math.min(100, Math.max(0, percent));
  const step = (direction: 1 | -1) => onChange(clamp(direction > 0 ? Math.floor(value / 5) * 5 + 5 : Math.ceil(value / 5) * 5 - 5));
  const stepButton = "grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line bg-canvas text-ink transition hover:bg-surface active:scale-95 disabled:opacity-35 disabled:active:scale-100";
  return <div>
    <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-2">
      <button type="button" className={stepButton} aria-label={t("5% kamaytirish", "5% lower")} disabled={value <= 0} onClick={() => step(-1)}><Minus className="h-5 w-5" /></button>
      <div className="min-w-0 flex-1 text-center">
        <p className="text-4xl font-extrabold tabular-nums tracking-tight text-ink" aria-live="polite">{value}%</p>
        <div className="mx-auto mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all" style={{ width: `${value}%` }} /></div>
      </div>
      <button type="button" className={stepButton} aria-label={t("5% oshirish", "5% higher")} disabled={value >= 100} onClick={() => step(1)}><Plus className="h-5 w-5" /></button>
    </div>
    <div className="mt-2 grid grid-cols-5 gap-1.5">{PRESETS.map((percent) => <button key={percent} type="button" onClick={() => onChange(percent)} className={cn(
      "rounded-xl border py-2 text-sm font-bold tabular-nums transition",
      value === percent ? "border-teal-500 bg-teal-500/10 text-teal-700 dark:text-teal-300" : "border-line text-ink hover:bg-surface",
    )}>{percent}</button>)}</div>
    {original !== undefined && original !== value && <button type="button" onClick={() => onChange(original)} className="mt-2 text-xs font-bold text-teal-700 hover:underline dark:text-teal-300">{t(`Testning o‘z bali: ${original}% — qaytarish`, `Test's own mark: ${original}% — reset`)}</button>}
  </div>;
}
