"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CheckCheck, Copy, KeyRound, LogOut, Pause, Play, RefreshCw, Send, UserX, Wifi, WifiOff, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";
import { api } from "@/lib/api";
import { clock, STATE_STYLES, stateLabel, type Participant, type SessionDetail } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;

export default function SessionMonitor({ params }: { params: { sessionId: string } }) {
  const { lang, t } = useLang();
  const { confirm, dialog } = useConfirm();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [closing, setClosing] = useState(false);
  const alive = useRef(true);

  const apply = useCallback((data: SessionDetail) => {
    if (!alive.current) return;
    setSession(data);
    setFetchedAt(Date.now());
    setError("");
  }, []);

  const load = useCallback(() => api<SessionDetail>(`/examiner/sessions/${params.sessionId}`)
    .then(apply)
    .catch((reason) => { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }), [apply, params.sessionId]);

  useEffect(() => {
    alive.current = true;
    load();
    const poll = window.setInterval(load, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive.current = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  async function act(path: string, key: string, body?: unknown) {
    setBusy(key);
    try {
      apply(await api<SessionDetail>(`/examiner/sessions/${params.sessionId}${path}`, {
        method: "POST", body: body === undefined ? undefined : JSON.stringify(body),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }
  const participantAct = (participant: Participant, action: string) =>
    act(`/participants/${participant.id}/${action}`, `${participant.id}:${action}`);

  // Remaining time ticks locally between polls for students who are working.
  function liveRemaining(participant: Participant) {
    if (participant.state !== "IN_PROGRESS") return participant.remaining_seconds;
    return Math.max(0, participant.remaining_seconds - Math.floor((now - fetchedAt) / 1000));
  }

  function copyCode() {
    if (!session) return;
    navigator.clipboard?.writeText(session.code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  }

  if (!session) {
    return <div className="mx-auto max-w-6xl p-4 sm:p-8">
      {error ? <p className="rounded-xl bg-red-500/10 p-4 text-sm font-semibold text-red-600">{error}</p> : <div className="h-64 animate-pulse rounded-3xl bg-canvas" />}
    </div>;
  }

  const active = session.status === "ACTIVE";
  const visible = session.participants.filter((row) => !["REJECTED", "REMOVED"].includes(row.state));
  const pending = visible.filter((row) => row.state === "PENDING");
  const seated = visible.filter((row) => row.state !== "PENDING");
  const working = seated.filter((row) => row.state === "IN_PROGRESS");
  const paused = seated.filter((row) => row.state === "PAUSED");
  const submitted = seated.filter((row) => row.state === "SUBMITTED");
  const left = seated.filter((row) => ["IN_PROGRESS", "PAUSED", "TIME_UP"].includes(row.state) && !row.online);
  const declined = session.participants.filter((row) => ["REJECTED", "REMOVED"].includes(row.state));
  const lastSeen = (value: string | null) => value
    ? new Date(value).toLocaleTimeString(lang === "uz" ? "uz-UZ" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    {dialog}
    <Link href="/examiner" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {t("Imtihonlar", "Exam sessions")}</Link>
    <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[.08em] text-teal-600">{session.level_name} · {session.exam_type_name} · {t("Variant", "Variant")} {session.variant_number}</p>
        <h1 className="mt-2 text-3xl font-extrabold text-ink">{session.title}</h1>
        <p className="mt-2 text-sm text-muted">{session.test_title} · {session.time_limit_minutes} {t("daqiqa", "minutes")} · {session.total_questions} {t("savol", "questions")}</p>
        <span className={cn("mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold", active ? "bg-emerald-500/10 text-emerald-600" : "bg-slate-500/10 text-slate-600")}>{active ? t("Faol — o'quvchilar kira oladi", "Active — students can join") : t("Yakunlangan", "Closed")}</span>
      </div>
      {active && <div className="shrink-0 rounded-3xl border border-teal-500/30 bg-teal-500/10 p-5 text-center lg:min-w-[300px]">
        <p className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300"><KeyRound className="h-3.5 w-3.5" /> {t("Imtihon paroli", "Exam password")}</p>
        <p className="mt-2 font-mono text-5xl font-extrabold tracking-[.25em] text-ink">{session.code}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={copyCode}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? t("Nusxalandi", "Copied") : t("Nusxalash", "Copy")}</Button>
          <Button size="sm" variant="secondary" disabled={busy === "code"} onClick={() => confirm({
            title: t("Yangi parol yaratilsinmi?", "Generate a new password?"),
            description: t("Eski parol bilan endi hech kim kira olmaydi. Allaqachon kirganlar davom etadi.", "Nobody can join with the old password any more. Students already in keep going."),
            confirmLabel: t("Yangi parol", "New password"),
            onConfirm: () => act("/regenerate-code", "code"),
          })}><RefreshCw className="h-4 w-4" /> {t("Yangi parol", "New password")}</Button>
        </div>
      </div>}
    </div>

    {error && <p className="mt-5 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}

    <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {[
        [t("Kutmoqda", "Waiting"), pending.length, "text-amber-600"],
        [t("Ishlamoqda", "Working"), working.length, "text-emerald-600"],
        [t("To'xtatilgan", "Paused"), paused.length, "text-violet-600"],
        [t("Chiqib ketgan", "Left / offline"), left.length, "text-red-600"],
        [t("Topshirgan", "Submitted"), submitted.length, "text-slate-600"],
      ].map(([label, value, tone]) => <div key={String(label)} className="rounded-2xl border border-line bg-canvas p-4"><p className="text-xs font-bold text-muted">{label}</p><p className={cn("mt-1 text-2xl font-extrabold", String(tone))}>{value}</p></div>)}
    </section>

    <div className="mt-5 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={!pending.length || !active || busy === "approve-all"} onClick={() => act("/approve-all", "approve-all")}><CheckCheck className="h-4 w-4" /> {t("Hammasini tasdiqlash", "Approve all")}</Button>
      <Button size="sm" variant="secondary" disabled={!working.length || busy === "pause-all"} onClick={() => confirm({
        title: t("Hammaning vaqti to'xtatilsinmi?", "Pause everyone?"),
        description: t("Ishlayotgan barcha o'quvchilarning vaqti to'xtaydi va ular davom ettirishingizni kutadi.", "Every working student's clock stops until you resume."),
        confirmLabel: t("To'xtatish", "Pause"), onConfirm: () => act("/pause-all", "pause-all"),
      })}><Pause className="h-4 w-4" /> {t("Hammasini to'xtatish", "Pause all")}</Button>
      <Button size="sm" variant="secondary" disabled={!paused.length || busy === "resume-all"} onClick={() => act("/resume-all", "resume-all")}><Play className="h-4 w-4" /> {t("Hammasini davom ettirish", "Resume all")}</Button>
      {active && <Button size="sm" variant="danger" className="ml-auto" onClick={() => setClosing(true)}><LogOut className="h-4 w-4" /> {t("Imtihonni yakunlash", "Close exam")}</Button>}
    </div>

    {pending.length > 0 && <section className="mt-7 rounded-3xl border-2 border-amber-400/60 bg-amber-500/5 p-4 sm:p-5">
      <h2 className="text-base font-extrabold text-ink">{t("Kirishga ruxsat so'rayotganlar", "Asking to start")} <span className="text-amber-600">({pending.length})</span></h2>
      <p className="mt-1 text-xs text-muted">{t("Parolni to'g'ri kiritdi. Tasdiqlasangiz imtihonni boshlay oladi.", "Entered the right password. Approve to let them start.")}</p>
      <div className="mt-4 space-y-2">{pending.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-canvas p-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-ink">{row.first_name} {row.last_name}</p><p className="text-xs text-muted">{row.phone_number}{row.username ? ` · @${row.username}` : ""} · {lastSeen(row.requested_at)}</p></div>
        <Button size="sm" className="!bg-emerald-600 hover:!bg-emerald-700" disabled={busy === `${row.id}:approve`} onClick={() => participantAct(row, "approve")}><Check className="h-4 w-4" /> {t("Tasdiqlash", "Approve")}</Button>
        <Button size="sm" variant="secondary" disabled={busy === `${row.id}:reject`} onClick={() => participantAct(row, "reject")}><X className="h-4 w-4" /> {t("Rad etish", "Reject")}</Button>
      </div>)}</div>
    </section>}

    <section className="mt-7">
      <h2 className="text-base font-extrabold text-ink">{t("O'quvchilar", "Students")} <span className="text-muted">({seated.length})</span></h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-canvas">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-surface text-[11px] font-bold uppercase tracking-wider text-muted"><tr>
            <th className="px-4 py-3">{t("O'quvchi", "Student")}</th><th className="px-4 py-3">{t("Holat", "Status")}</th><th className="px-4 py-3">{t("Aloqa", "Connection")}</th><th className="px-4 py-3">{t("Qolgan vaqt", "Time left")}</th><th className="px-4 py-3">{t("Javoblar", "Answers")}</th><th className="px-4 py-3 text-right">{t("Amallar", "Actions")}</th>
          </tr></thead>
          <tbody>{seated.length ? seated.map((row) => {
            const remaining = liveRemaining(row);
            const share = session.total_questions ? Math.min(100, Math.round(row.answered_count / session.total_questions * 100)) : 0;
            const running = ["IN_PROGRESS", "PAUSED", "TIME_UP"].includes(row.state);
            return <tr key={row.id} className={cn("border-t border-line", running && !row.online && "bg-red-500/5")}>
              <td className="px-4 py-3"><p className="font-extrabold text-ink">{row.first_name} {row.last_name}</p><p className="text-xs text-muted">{row.username ? `@${row.username}` : row.phone_number}</p></td>
              <td className="px-4 py-3"><span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", STATE_STYLES[row.state])}>{stateLabel(row.state, t)}</span>{row.state === "SUBMITTED" && row.percentage !== null && <span className="ml-2 text-xs font-bold text-ink">{Math.round(row.percentage)}%</span>}</td>
              <td className="px-4 py-3">{running ? (row.online
                ? <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600"><Wifi className="h-3.5 w-3.5" /> {t("Imtihonda", "On exam")}</span>
                : <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600" title={lastSeen(row.last_seen_at)}><WifiOff className="h-3.5 w-3.5" /> {t("Chiqib ketgan", "Left")} · {lastSeen(row.last_seen_at)}</span>)
                : <span className="text-xs text-muted">—</span>}</td>
              <td className="px-4 py-3">{row.attempt_id ? <span className={cn("font-mono text-base font-extrabold", remaining <= 300 && row.state !== "SUBMITTED" ? "text-red-600" : "text-ink")}>{row.state === "SUBMITTED" ? "—" : clock(remaining)}</span> : <span className="text-xs text-muted">{t("Boshlamagan", "Not started")}</span>}</td>
              <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-teal-500" style={{ width: `${share}%` }} /></div><span className="text-xs font-bold text-muted">{row.answered_count}/{session.total_questions}</span></div></td>
              <td className="px-4 py-3"><div className="flex justify-end gap-1.5">
                {row.state === "IN_PROGRESS" && <Button size="sm" variant="secondary" disabled={busy === `${row.id}:pause`} onClick={() => participantAct(row, "pause")}><Pause className="h-4 w-4" /> {t("To'xtatish", "Pause")}</Button>}
                {row.state === "PAUSED" && <Button size="sm" className="!bg-emerald-600 hover:!bg-emerald-700" disabled={busy === `${row.id}:resume`} onClick={() => participantAct(row, "resume")}><Play className="h-4 w-4" /> {t("Davom ettirish", "Resume")}</Button>}
                {running && <Button size="sm" variant="secondary" title={t("Hozirgi javoblar bilan topshirish", "Submit with current answers")} onClick={() => confirm({
                  title: t(`${row.first_name}ning imtihoni topshirilsinmi?`, `Submit ${row.first_name}'s exam?`),
                  description: t("Hozirgacha saqlangan javoblar bilan baholanadi.", "It is graded with the answers saved so far."),
                  confirmLabel: t("Topshirish", "Submit"), onConfirm: () => participantAct(row, "submit"),
                })}><Send className="h-4 w-4" /></Button>}
                {row.state !== "SUBMITTED" && <Button size="sm" variant="ghost" title={t("Imtihondan chiqarish", "Remove from exam")} onClick={() => confirm({
                  title: t(`${row.first_name} imtihondan chiqarilsinmi?`, `Remove ${row.first_name}?`),
                  description: t("O'quvchi bu imtihonga boshqa kira olmaydi.", "The student can't come back into this exam."),
                  confirmLabel: t("Chiqarish", "Remove"), variant: "danger", onConfirm: () => participantAct(row, "remove"),
                })}><UserX className="h-4 w-4" /></Button>}
              </div></td>
            </tr>;
          }) : <tr><td colSpan={6} className="p-10 text-center text-sm text-muted">{active ? t("Hali hech kim kirmadi. O'quvchilar testni ochib, yuqoridagi parolni kiritadi.", "Nobody yet. Students open the test and enter the password above.") : t("Hech kim qatnashmadi.", "Nobody took part.")}</td></tr>}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">{t("O'quvchi imtihon sahifasini yopsa yoki interneti uzilsa ~20 soniyada \"Chiqib ketgan\" bo'lib ko'rinadi. Uning vaqti to'xtashi uchun \"To'xtatish\"ni bosing — qaytib kirganda o'sha joydan davom etadi.", "If a student closes the exam or loses connection they show as \"Left\" within ~20s. Press \"Pause\" to stop their clock — they continue from the same point when they come back.")}</p>
    </section>

    {declined.length > 0 && <section className="mt-7"><h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">{t("Rad etilgan / chiqarilgan", "Rejected / removed")}</h2><div className="mt-2 flex flex-wrap gap-2">{declined.map((row) => <span key={row.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-bold text-ink">{row.first_name} {row.last_name}<span className={cn("rounded-full px-2 py-0.5", STATE_STYLES[row.state])}>{stateLabel(row.state, t)}</span>{row.state === "REJECTED" && active && <button type="button" className="text-teal-600 hover:underline" onClick={() => participantAct(row, "approve")}>{t("Tasdiqlash", "Approve")}</button>}</span>)}</div></section>}

    {closing && <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setClosing(false)}>
      <div className="w-full max-w-md rounded-3xl border border-line bg-canvas p-6 shadow-lift" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-ink">{t("Imtihonni yakunlash", "Close the exam")}</h2>
        <p className="mt-2 text-sm text-muted">{t("Parol bekor bo'ladi, yangi o'quvchi kira olmaydi, kutayotganlar rad etiladi.", "The password stops working, nobody new can join and anyone waiting is turned away.")}</p>
        <div className="mt-5 space-y-2">
          <Button className="w-full" variant="danger" disabled={busy === "close"} onClick={async () => { await act("/close", "close", { submit_in_progress: true }); setClosing(false); }}>{t("Yakunlash va ishlayotganlarni topshirish", "Close and submit everyone still working")}</Button>
          <Button className="w-full" variant="secondary" disabled={busy === "close"} onClick={async () => { await act("/close", "close", { submit_in_progress: false }); setClosing(false); }}>{t("Faqat yangi kirishni yopish", "Only stop new students joining")}</Button>
          <Button className="w-full" variant="ghost" onClick={() => setClosing(false)}>{t("Bekor qilish", "Cancel")}</Button>
        </div>
      </div>
    </div>}
  </div>;
}
