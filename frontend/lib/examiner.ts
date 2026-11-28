// Shared types and helpers for the examiner panel and the student-side
// session (password / waiting room) screens.

export type CatalogLevel = { id: string; name: string; slug: string };
export type CatalogExamType = { id: string; name: string; slug: string };
export type CatalogVariant = {
  id: string; title: string; variant_number: number; level_id: string; exam_type_id: string;
  time_limit_minutes: number; passing_percentage: number; question_count: number;
};
export type ExaminerCatalog = { levels: CatalogLevel[]; exam_types: CatalogExamType[]; variants: CatalogVariant[] };

export type ParticipantState =
  | "PENDING" | "REJECTED" | "REMOVED" | "APPROVED" | "IN_PROGRESS" | "PAUSED" | "TIME_UP" | "SUBMITTED";

export type SessionSummary = {
  id: string; title: string; code: string; status: "ACTIVE" | "CLOSED"; created_at: string; closed_at: string | null;
  examiner_name: string | null; test_title: string; variant_number: number; time_limit_minutes: number;
  level_name: string; exam_type_name: string; pending: number; in_progress: number; submitted: number; total: number;
  writing_total?: number; writing_awaiting?: number; passing_percentage?: number;
};

export type Participant = {
  id: string; user_id: string; first_name: string; last_name: string; phone_number: string; username: string | null;
  avatar_url: string | null; status: string; state: ParticipantState; requested_at: string; last_seen_at: string | null;
  online: boolean; attempt_id: string | null; started_at: string | null; paused: boolean;
  elapsed_seconds: number; remaining_seconds: number; answered_count: number; percentage: number | null;
  violations?: number; max_violations?: number; exam_mode?: boolean; passed?: boolean;
};

export type SessionDetail = Omit<SessionSummary, "pending" | "in_progress" | "submitted" | "total" | "examiner_name"> & {
  total_questions: number; level_slug: string; exam_type_slug: string; test_variant_id: string;
  participants: Participant[]; server_time: string;
  test_time_limit_minutes?: number; min_time_limit_minutes?: number; running_count?: number;
  passing_percentage: number; test_passing_percentage?: number;
};

export type Grant = {
  id: string; scope: "ALL" | "LEVEL" | "EXAM_TYPE" | "VARIANT";
  level_id: string | null; exam_type_id: string | null; test_variant_id: string | null;
  level_name: string | null; exam_type_name: string | null; test_title: string | null; created_at: string;
};

export type StudentRow = {
  id: string; first_name: string; last_name: string; phone_number: string; username: string | null;
  is_active: boolean; created_at: string; avatar_url: string | null; grants: Grant[];
  exam_mode?: boolean;
};

// Examiner results & writing review.
export type WritingStatus = "awaiting" | "ai_graded" | "teacher_graded";

export type ResultRow = {
  participant_id: string; user_id: string; attempt_id: string;
  first_name: string; last_name: string; phone_number: string; username: string | null; exam_mode: boolean;
  status: string; removed: boolean; score: number; max_score: number; percentage: number | null;
  submitted_at: string | null; time_spent_seconds: number; violations: number; max_violations: number;
  correct: number; incorrect: number; pending: number;
  writing_total: number; writing_ai: number; writing_teacher: number; writing_awaiting: number;
  writing_points: number; writing_max: number;
};

export type SessionResults = {
  id: string; title: string; code: string; status: "ACTIVE" | "CLOSED"; created_at: string;
  test_title: string; level_name: string; exam_type_name: string; variant_number: number; time_limit_minutes: number;
  students: ResultRow[];
};

export type ReviewQuestion = {
  id: string; prompt: string; options: unknown; student_answer: unknown; correct_answer: unknown;
  is_correct: boolean | null; points_awarded: number | null; max_points: number;
  feedback: string | null; annotations: { start: number; end: number; comment: string }[];
  status: WritingStatus | null; graded_by_name: string | null; graded_at: string | null;
};

export type AttemptReview = {
  attempt_id: string; session_id: string; session_title: string; test_title: string; status: string;
  student: { id: string; first_name: string; last_name: string; phone_number: string; username: string | null; exam_mode: boolean };
  score: number; max_score: number; percentage: number | null; passing_percentage: number;
  started_at: string; submitted_at: string | null; time_spent_seconds: number;
  violations: number; max_violations: number;
  sections: { title: string; tasks: { id: string; title: string; type: string; manual: boolean; instructions: string; questions: ReviewQuestion[] }[] }[];
};

export function writingStatusLabel(status: WritingStatus, t: (uz: string, en: string) => string) {
  return status === "ai_graded" ? t("AI baholadi", "AI graded")
    : status === "teacher_graded" ? t("Teacher baholadi", "Teacher graded")
      : t("Baho kutilmoqda", "Awaiting grade");
}

export const WRITING_STATUS_STYLES: Record<WritingStatus, string> = {
  ai_graded: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  teacher_graded: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  awaiting: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

/** Any stored answer shape (text, list, matching map) as readable text. */
export function formatAnswer(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? value.map((item) => formatAnswer(item)).join(", ") : "—";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? entries.map(([key, item]) => `${key} → ${formatAnswer(item)}`).join("; ") : "—";
  }
  return String(value);
}

// What the student's waiting-room / join endpoints return.
export type MySession = {
  session_id: string; participant_id: string; title: string; session_status: "ACTIVE" | "CLOSED";
  status: "PENDING" | "APPROVED" | "REJECTED" | "REMOVED"; state: ParticipantState;
  attempt_id: string | null; attempt_status: string | null; paused: boolean; remaining_seconds: number;
  test_variant_id: string; test_title: string; level_slug: string; level_name: string;
  exam_type_slug: string; exam_type_name: string; time_limit_minutes: number;
};

export function clock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(rest).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function grantLabel(grant: Grant, t: (uz: string, en: string) => string) {
  if (grant.scope === "ALL") return t("Barcha testlar", "All tests");
  if (grant.scope === "LEVEL") return `${grant.level_name ?? "?"} — ${t("butun daraja", "whole level")}`;
  if (grant.scope === "EXAM_TYPE") return `${grant.level_name ?? "?"} · ${grant.exam_type_name ?? "?"}`;
  return grant.test_title ?? t("Test", "Test");
}

export const STATE_STYLES: Record<ParticipantState, string> = {
  PENDING: "bg-amber-500/15 text-amber-600",
  APPROVED: "bg-sky-500/10 text-sky-600",
  IN_PROGRESS: "bg-emerald-500/10 text-emerald-600",
  PAUSED: "bg-violet-500/10 text-violet-600",
  TIME_UP: "bg-red-500/10 text-red-600",
  SUBMITTED: "bg-slate-500/10 text-slate-600",
  REJECTED: "bg-red-500/10 text-red-600",
  REMOVED: "bg-red-500/10 text-red-600",
};

export function stateLabel(state: ParticipantState, t: (uz: string, en: string) => string) {
  switch (state) {
    case "PENDING": return t("Tasdiq kutmoqda", "Awaiting approval");
    case "APPROVED": return t("Tasdiqlandi", "Approved");
    case "IN_PROGRESS": return t("Ishlamoqda", "In progress");
    case "PAUSED": return t("To'xtatilgan", "Paused");
    case "TIME_UP": return t("Vaqt tugadi", "Time up");
    case "SUBMITTED": return t("Topshirdi", "Submitted");
    case "REJECTED": return t("Rad etildi", "Rejected");
    case "REMOVED": return t("Chiqarildi", "Removed");
  }
}

const UZ_MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15-noy, 01:05" / "15 Nov, 01:05" — browsers render the uz-UZ locale as "M11". */
export function formatDateTime(value: string | null | undefined, lang: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return lang === "uz"
    ? `${date.getDate()}-${UZ_MONTHS[date.getMonth()]}, ${time}`
    : `${date.getDate()} ${EN_MONTHS[date.getMonth()]}, ${time}`;
}
