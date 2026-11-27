"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { MySession } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";

/** Asks for the examiner's session password. With testVariantId the password
 * must belong to exactly that test; without it (dashboard) any active
 * session's password is accepted. On success the student lands in the
 * waiting room until the examiner approves them. */
export function ExamPasswordDialog({ testVariantId, testTitle, onClose }: {
  testVariantId?: string; testTitle?: string; onClose: () => void;
}) {
  const { t } = useLang();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const joined = await api<MySession>("/exam-sessions/join", {
        method: "POST", body: JSON.stringify({ code, test_variant_id: testVariantId ?? null }),
      });
      router.push(`/exam-session/${joined.session_id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Kirib bo'lmadi.", "Unable to join."));
      setBusy(false);
    }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
    <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-line bg-canvas p-6 text-center shadow-lift" onClick={(event) => event.stopPropagation()}>
      <div className="flex justify-end"><button type="button" onClick={onClose} aria-label={t("Yopish", "Close")} className="rounded-lg p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button></div>
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand"><Lock className="h-6 w-6" /></span>
      <h2 className="mt-4 text-xl font-extrabold text-ink">{t("Imtihon paroli", "Exam password")}</h2>
      <p className="mt-2 text-sm text-muted">{testTitle
        ? t(`"${testTitle}" yopiq. Examiner bergan 6 xonali parolni kiriting.`, `"${testTitle}" is locked. Enter the 6-digit password from your examiner.`)
        : t("Examiner bergan 6 xonali parol.", "The 6-digit password from your examiner.")}</p>
      <Input ref={input} className="mt-5 text-center font-mono text-2xl font-extrabold tracking-[.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
      <Button className="mt-5 w-full" size="lg" disabled={busy || code.length < 6}><KeyRound className="h-4 w-4" /> {busy ? t("Tekshirilmoqda…", "Checking…") : t("Kirish", "Enter")}</Button>
      <p className="mt-3 text-xs text-muted">{t("Examiner tasdiqlagach boshlanadi.", "Starts once the examiner approves.")}</p>
    </form>
  </div>;
}
