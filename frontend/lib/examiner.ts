// Shared types and helpers for the examiner panel and the student-side
// session (password / waiting room) screens.

export type CatalogLevel = { id: string; name: string; slug: string };
export type CatalogExamType = { id: string; name: string; slug: string };
export type CatalogVariant = {
  id: string; title: string; variant_number: number; level_id: string; exam_type_id: string;
  time_limit_minutes: number; question_count: number;
};
export type ExaminerCatalog = { levels: CatalogLevel[]; exam_types: CatalogExamType[]; variants: CatalogVariant[] };

export type ParticipantState =
  | "PENDING" | "REJECTED" | "REMOVED" | "APPROVED" | "IN_PROGRESS" | "PAUSED" | "TIME_UP" | "SUBMITTED";

export type SessionSummary = {
  id: string; title: string; code: string; status: "ACTIVE" | "CLOSED"; created_at: string; closed_at: string | null;
  examiner_name: string | null; test_title: string; variant_number: number; time_limit_minutes: number;
  level_name: string; exam_type_name: string; pending: number; in_progress: number; submitted: number; total: number;
};

export type Participant = {
  id: string; user_id: string; first_name: string; last_name: string; phone_number: string; username: string | null;
  avatar_url: string | null; status: string; state: ParticipantState; requested_at: string; last_seen_at: string | null;
  online: boolean; attempt_id: string | null; started_at: string | null; paused: boolean;
  elapsed_seconds: number; remaining_seconds: number; answered_count: number; percentage: number | null;
};

export type SessionDetail = Omit<SessionSummary, "pending" | "in_progress" | "submitted" | "total" | "examiner_name"> & {
  total_questions: number; level_slug: string; exam_type_slug: string; test_variant_id: string;
  participants: Participant[]; server_time: string;
};

export type Grant = {
  id: string; scope: "ALL" | "LEVEL" | "EXAM_TYPE" | "VARIANT";
  level_id: string | null; exam_type_id: string | null; test_variant_id: string | null;
  level_name: string | null; exam_type_name: string | null; test_title: string | null; created_at: string;
};

export type StudentRow = {
  id: string; first_name: string; last_name: string; phone_number: string; username: string | null;
  is_active: boolean; created_at: string; avatar_url: string | null; grants: Grant[];
};

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
