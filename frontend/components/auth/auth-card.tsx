"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Bot, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function AuthCard({ initialTab = "sign-in" }: { initialTab?: "sign-in" | "create" }) {
  const [tab, setTab] = useState(initialTab);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpMode, setOtpMode] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpCooldown, setOtpCooldown] = useState(0);
  const router = useRouter();
  type AuthResult = { user: { role: "STUDENT" | "ADMIN" | "SUPER_ADMIN" } };
  useEffect(() => {
    if (!otpCooldown) return;
    const timer = window.setInterval(() => setOtpCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [otpCooldown]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (otpMode) {
        const result = await api<AuthResult>("/auth/telegram/verify-otp", {
          method: "POST",
          body: JSON.stringify({ phone_number: phone, code: otp, purpose: "login" }),
        });
        router.push(result.user.role === "STUDENT" ? "/dashboard" : "/admin");
      } else if (tab === "create") {
        await api<AuthResult>("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            first_name: firstName, last_name: lastName, phone_number: phone,
            password, confirm_password: confirmPassword,
          }),
        });
        router.push("/dashboard");
      } else {
        const result = await api<AuthResult>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ phone_number: phone, password }),
        });
        router.push(result.user.role === "STUDENT" ? "/dashboard" : "/admin");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue.");
    } finally {
      setLoading(false);
    }
  }

  async function requestTelegramOtp() {
    if (!phone.trim()) {
      setError("Enter your phone number first.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api("/auth/telegram/request-otp", {
        method: "POST",
        body: JSON.stringify({ phone_number: phone, purpose: "login" }),
      });
      setOtpMode(true);
      setOtpCooldown(60);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to request a code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-[28px] border border-line bg-canvas p-2 shadow-soft">
      <div className="grid grid-cols-2 rounded-2xl bg-surface p-1">
        <button onClick={() => { setTab("sign-in"); setOtpMode(false); setError(""); }} className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === "sign-in" ? "bg-canvas text-ink shadow-sm" : "text-muted"}`}>Sign In</button>
        <button onClick={() => { setTab("create"); setOtpMode(false); setError(""); }} className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === "create" ? "bg-canvas text-ink shadow-sm" : "text-muted"}`}>Create Account</button>
      </div>
      <div className="px-5 pb-6 pt-7 sm:px-8">
        <div className="mb-7">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-brand">{tab === "sign-in" ? "Welcome back" : "Start learning"}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{tab === "sign-in" ? "Continue your progress" : "Create your account"}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{tab === "sign-in" ? "Your next milestone is waiting." : "A few details and you’re ready to begin."}</p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {tab === "create" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-sm font-semibold text-ink">First Name<Input placeholder="Alex" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label>
              <label className="space-y-2 text-sm font-semibold text-ink">Last Name<Input placeholder="Morgan" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label>
            </div>
          )}
          <label className="block space-y-2 text-sm font-semibold text-ink">
            Phone Number
            <div className="flex">
              <span className="grid h-12 place-items-center rounded-l-xl border border-r-0 border-line bg-surface px-3 text-sm font-bold text-ink">+998</span>
              <Input className="rounded-l-none" inputMode="numeric" placeholder="90 123 45 67" value={phone} onChange={(event) => setPhone(event.target.value)} required />
            </div>
          </label>
          {!otpMode && <label className="block space-y-2 text-sm font-semibold text-ink">
            Password
            <div className="relative">
              <Input type={showPassword ? "text" : "password"} placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Show password" className="absolute right-3 top-3 text-muted">{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
            </div>
          </label>}
          {tab === "create" && (
            <label className="block space-y-2 text-sm font-semibold text-ink">Confirm Password<Input type="password" placeholder="Repeat your password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
          )}
          {otpMode && <label className="block space-y-2 text-sm font-semibold text-ink">Verification Code<Input className="text-center font-mono text-lg tracking-[.45em]" inputMode="numeric" maxLength={5} placeholder="00000" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} required /></label>}
          {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
          {tab === "sign-in" && !otpMode && <div className="flex justify-end"><Link href="/forgot-password" className="text-sm font-semibold text-brand hover:underline">Forgot password?</Link></div>}
          <Button className="w-full" size="lg" disabled={loading}>
            {loading ? "Please wait…" : otpMode ? "Verify & Sign In" : tab === "sign-in" ? "Sign In" : "Create Account"} {!loading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>
        {tab === "sign-in" && (
          <>
            <div className="my-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-muted"><span className="h-px flex-1 bg-line" />or continue securely<span className="h-px flex-1 bg-line" /></div>
            <Button type="button" variant="secondary" className="w-full" size="lg" onClick={requestTelegramOtp} disabled={loading || otpCooldown > 0}><Bot className="h-5 w-5 text-sky-500" /> {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : otpMode ? "Resend Telegram code" : "Sign in via Telegram bot"}</Button>
          </>
        )}
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Your data is encrypted and protected</div>
      </div>
    </div>
  );
}
