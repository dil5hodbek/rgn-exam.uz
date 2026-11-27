import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Exam time without seconds: "6 daq", "1 soat 5 daq" (en: "6 min", "1 h 5 min"). */
export function formatDuration(seconds: number, lang = "uz") {
  const totalMinutes = Math.max(0, Math.round(Math.max(0, seconds) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const uz = lang === "uz";
  if (!hours) return uz ? `${minutes} daq` : `${minutes} min`;
  if (!minutes) return uz ? `${hours} soat` : `${hours} h`;
  return uz ? `${hours} soat ${minutes} daq` : `${hours} h ${minutes} min`;
}

// Long totals (e.g. all practice time): hours and minutes, no seconds.
export const formatHoursMinutes = formatDuration;

const UZ_MONTHS_FULL = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const EN_MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A calendar day: "21-noyabr" / "21 November" (the year only when it is not this year). */
export function formatDay(value: string | null | undefined, lang = "uz") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const year = date.getFullYear() !== new Date().getFullYear() ? ` ${date.getFullYear()}` : "";
  return lang === "uz"
    ? `${date.getDate()}-${UZ_MONTHS_FULL[date.getMonth()]}${year}`
    : `${date.getDate()} ${EN_MONTHS_FULL[date.getMonth()]}${year}`;
}
