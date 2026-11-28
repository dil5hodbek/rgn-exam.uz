"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock3, Hourglass, PauseCircle, ShieldX } from "lucide-react";
import { BrowserAdvice } from "@/components/exam/browser-advice";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { clock, type MySession } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";

const POLL_MS = 2500;

/** The waiting room: after entering the session password the student sits
 * here until the examiner approves them, then the attempt starts by itself.
 * Coming back later (closed tab, lost connection) lands here too and drops
 * them straight back into the same attempt. */
export default function ExamSessionRoom({ params }: { params: { sessionId: string } }) {
  const { t } = useLang();
  const router = useRouter();
  const [session, setSession] = useState<MySession | null>(null);
  const [error, setError] = useState("");
  const starting = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const attemptPath = (row: MySession) =>
      `/dashboard/${row.level_slug}/${row.exam_type_slug}/${row.test_variant_id}/attempt?attempt=${encodeURIComponent(row.attempt_id ?? "")}`;

    async function poll() {
      try {
        const row = await api<MySession>(`/exam-sessions/${params.sessionId}/me`);
        if (!alive) return;
        setSession(row);
        setError("");
        if (row.status === "APPROVED" && (!row.attempt_id || row.attempt_status === "IN_PROGRESS") && !starting.current) {
          starting.current = true;
          const started = await api<MySession>(`/exam-sessions/${params.sessionId}/start`, { method: "POST" });
          if (!alive) return;
          router.replace(attemptPath(started));
          return;
        }
      } catch (reason) {
        starting.current = false;
        if (!alive) return;
        if (reason instanceof ApiError && reason.status === 404) { setError(t("Siz bu imtihonga qo'shilmagansiz.", "You haven't joined this exam.")); return; }
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      if (alive) timer = window.setTimeout(poll, POLL_MS);
    }
    poll();
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.sessionId]);

  const card = (icon: React.ReactNode, title: string, body: string, extra?: React.ReactNode) =>
    <div className="mx-auto mt-10 max-w-lg rounded-3xl border border-line bg-canvas p-8 text-center shadow-sm">
      {icon}
      <h1 className="mt-5 text-2xl font-extrabold text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
      {extra}
    </div>;

  const back = <Link href="/dashboard" className="mt-6 inline-flex"><Button variant="secondary"><ArrowLeft className="h-4 w-4" /> {t("Bosh sahifa", "Dashboard")}</Button></Link>;
  const info = session && <div className="mt-6 rounded-2xl bg-surface p-4 text-left text-sm">
    <p className="text-xs font-bold uppercase tracking-wider text-muted">{session.level_name} · {session.exam_type_name}</p>
    <p className="mt-1 font-extrabold text-ink">{session.title}</p>
    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Clock3 className="h-3.5 w-3.5" /> {session.time_limit_minutes} {t("daqiqa", "minutes")}</p>
  </div>;

  return <div className="px-4 py-8 sm:px-8">
    {error && !session && card(<ShieldX className="mx-auto h-14 w-14 text-red-500" />, t("Xatolik", "Something went wrong"), error, back)}
    {!session && !error && <div className="mx-auto mt-10 h-72 max-w-lg animate-pulse rounded-3xl bg-canvas" />}
    {session && session.state === "PENDING" && card(
      <span className="relative mx-auto grid h-16 w-16 place-items-center"><span className="absolute inset-0 animate-ping rounded-full bg-amber-400/30" /><Hourglass className="relative h-10 w-10 text-amber-500" /></span>,
      t("Examiner tasdiqlashini kuting", "Waiting for the examiner"),
      t("Parol to‘g‘ri. Examiner tasdiqlashini kuting.", "Password accepted. Waiting for the examiner."),
      <>{info}<BrowserAdvice className="mt-4" />{error && <p className="mt-4 text-xs font-semibold text-red-600">{error}</p>}</>,
    )}
    {session && session.status === "APPROVED" && session.attempt_status !== "IN_PROGRESS" && session.attempt_id && card(
      <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />,
      t("Imtihon topshirildi", "Exam submitted"),
      t("Bu imtihonni allaqachon topshirgansiz.", "You have already submitted this exam."),
      <div className="mt-6 flex justify-center gap-2">{back}<Link href={`/dashboard/${session.level_slug}/${session.exam_type_slug}/${session.test_variant_id}/result/${session.attempt_id}`} className="mt-6 inline-flex"><Button>{t("Natijani ko'rish", "View result")}</Button></Link></div>,
    )}
    {session && session.status === "APPROVED" && (!session.attempt_id || session.attempt_status === "IN_PROGRESS") && card(
      <PauseCircle className="mx-auto h-14 w-14 animate-pulse text-emerald-500" />,
      t("Tasdiqlandi!", "Approved!"),
      t("Imtihon ochilmoqda…", "Opening your exam…"),
      info,
    )}
    {session && session.status === "REJECTED" && card(
      <ShieldX className="mx-auto h-14 w-14 text-red-500" />,
      t("Examiner kirishga ruxsat bermadi", "The examiner didn't let you in"),
      session.session_status === "ACTIVE"
        ? t("Xato bo‘lsa, examinerga ayting.", "If this is a mistake, tell the examiner.")
        : t("Imtihon yakunlangan.", "The exam has been closed."),
      back,
    )}
    {session && session.status === "REMOVED" && card(
      <ShieldX className="mx-auto h-14 w-14 text-red-500" />,
      t("Siz imtihondan chiqarildingiz", "You were removed from this exam"),
      t("Savol bo‘lsa, examinerga ayting.", "Questions? Ask the examiner."),
      back,
    )}
    {session && session.remaining_seconds > 0 && session.attempt_status === "IN_PROGRESS" && <p className="mt-4 text-center text-xs text-muted">{t("Qolgan vaqt", "Time left")}: {clock(session.remaining_seconds)}</p>}
  </div>;
}
