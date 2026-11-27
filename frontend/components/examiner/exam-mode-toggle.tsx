"use client";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { StudentRow } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The switch itself: a pill track with a sliding knob. */
export function Switch({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string;
}) {
  return <button
    type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    onClick={(event) => { event.stopPropagation(); onChange(!checked); }}
    className={cn(
      "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50",
      checked ? "bg-teal-500" : "bg-slate-300 dark:bg-slate-600",
    )}
  >
    <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
  </button>;
}

/**
 * Exam mode for one student: on by default for everyone (fullscreen lock,
 * leaves counted, the 3rd leave submits the exam). Switching it off applies
 * at once — also to an exam the student is sitting right now.
 */
export function ExamModeToggle({ studentId, enabled, maxViolations = 3, compact = false, onChange }: {
  studentId: string; enabled: boolean; maxViolations?: number; compact?: boolean;
  onChange?: (enabled: boolean, row: StudentRow) => void;
}) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle(next: boolean) {
    setBusy(true);
    setError("");
    try {
      const row = await api<StudentRow>(`/examiner/students/${studentId}`, {
        method: "PATCH", body: JSON.stringify({ exam_mode: next }),
      });
      onChange?.(row.exam_mode !== false, row);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Saqlab bo'lmadi.", "Could not save."));
    } finally {
      setBusy(false);
    }
  }
  const Icon = enabled ? ShieldCheck : ShieldOff;
  return <div className={cn(
    "flex items-center gap-3 rounded-2xl border transition-colors",
    compact ? "p-3" : "p-4",
    enabled ? "border-teal-500/30 bg-teal-500/5" : "border-amber-500/40 bg-amber-500/10",
  )}>
    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", enabled ? "bg-teal-500/15 text-teal-600 dark:text-teal-300" : "bg-amber-500/15 text-amber-600 dark:text-amber-300")}>
      <Icon className="h-5 w-5" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-extrabold text-ink">{t("Imtihon rejimi", "Exam mode")} · <span className={enabled ? "text-teal-600 dark:text-teal-300" : "text-amber-600 dark:text-amber-300"}>{enabled ? t("Yoqilgan", "On") : t("O'chirilgan", "Off")}</span></p>
      <p className="mt-0.5 text-xs leading-5 text-muted">{enabled
        ? t(`To‘liq ekran. ${maxViolations} ta chiqishda imtihon yakunlanadi.`, `Fullscreen. ${maxViolations} exits end the exam.`)
        : t("To‘liq ekransiz, chiqishlar sanalmaydi.", "No fullscreen, exits not counted.")}</p>
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </div>
    <Switch checked={enabled} disabled={busy} onChange={toggle} label={t("Imtihon rejimi", "Exam mode")} />
  </div>;
}
