"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bot, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export default function ForgotPassword() {
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [botUrl, setBotUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);
  async function requestCode() {
    if (!phone.trim()) { setError("Enter your phone number first."); return; }
    setLoading(true); setError("");
    try {
      const result = await api<{ message: string; bot_url?: string }>("/auth/telegram/request-otp", { method: "POST", body: JSON.stringify({ phone_number: phone, purpose: "reset" }) });
      const url = result.bot_url ?? "";
      setNotice(result.message); setBotUrl(url); setStep("code"); setCooldown(60);
      // Send the user straight to the bot; the button below is the fallback if
      // the browser blocks the pop-up.
      if (url) window.open(url, "_blank", "noopener");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to request code."); }
    finally { setLoading(false); }
  }
  async function verifyCode() {
    setLoading(true); setError("");
    try {
      const result = await api<{ reset_token: string }>("/auth/telegram/verify-otp", { method: "POST", body: JSON.stringify({ phone_number: phone, code, purpose: "reset" }) });
      setResetToken(result.reset_token); setStep("password");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid code."); }
    finally { setLoading(false); }
  }
  async function savePassword() {
    setLoading(true); setError("");
    try {
      await api("/auth/forgot-password/reset", { method: "POST", body: JSON.stringify({ reset_token: resetToken, password, confirm_password: confirmPassword }) });
      router.push("/sign-in");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to reset password."); }
    finally { setLoading(false); }
  }
  return <div className="w-full max-w-md rounded-[28px] border border-line bg-canvas p-8 shadow-soft"><Link href="/sign-in" className="inline-flex items-center gap-2 text-sm font-bold text-muted"><ArrowLeft className="h-4 w-4" /> Back to Sign In</Link><span className="mt-8 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500">{step === "code" ? <Bot /> : <KeyRound />}</span><h1 className="mt-5 text-3xl font-extrabold text-ink">{step === "phone" ? "Reset your password" : step === "code" ? "Check Telegram" : "Set a new password"}</h1><p className="mt-2 text-sm leading-6 text-muted">{step === "phone" ? "Enter your ExamFlow phone number." : step === "code" ? "Open the bot, tap Start, and share your phone number to get the code." : "Choose a strong password for your account."}</p>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    {notice && step === "code" && <div className="mt-4 rounded-xl bg-sky-500/10 p-3 text-sm leading-5 text-sky-800"><p>{notice}</p></div>}
    {step === "code" && botUrl && <a href={botUrl} target="_blank" rel="noreferrer" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition hover:opacity-90"><Bot className="h-4 w-4" /> Open ExamFlow bot</a>}
    {step === "phone" && <div className="mt-6"><label className="text-sm font-bold text-ink">Phone Number<div className="mt-2 flex"><span className="grid h-12 place-items-center rounded-l-xl border border-r-0 border-line bg-surface px-3 text-sm font-bold">+998</span><Input className="rounded-l-none" placeholder="90 123 45 67" value={phone} onChange={(event) => setPhone(event.target.value)} /></div></label><Button className="mt-4 w-full" onClick={requestCode} disabled={loading}><Bot className="h-4 w-4" /> Send Verification Code</Button></div>}
    {step === "code" && <div className="mt-6"><Input className="text-center font-mono text-lg tracking-[.5em]" maxLength={5} inputMode="numeric" placeholder="00000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /><Button className="mt-4 w-full" onClick={verifyCode} disabled={loading || code.length !== 5}>Verify Code</Button><button onClick={requestCode} disabled={loading || cooldown > 0} className="mt-4 w-full text-xs font-bold text-brand disabled:opacity-50">{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</button></div>}
    {step === "password" && <div className="mt-6 space-y-3"><Input type="password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} /><Input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><Button className="w-full" onClick={savePassword} disabled={loading}>Save New Password</Button></div>}
  </div>;
}
