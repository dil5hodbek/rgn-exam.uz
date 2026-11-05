"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export function AuthCard({ initialTab = "sign-in" }: { initialTab?: "sign-in" | "create" }) {
  const { t } = useLang();
  const [tab, setTab] = useState(initialTab);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  type AuthResult = { user: { role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN" } };
  function landingFor(role: AuthResult["user"]["role"]) {
    if (role === "STUDENT") return "/dashboard";
    if (role === "TEACHER") return "/monitor";
    return "/admin";
  }
  // A visitor who still has a valid session (cookies intact, possibly just
  // refreshed) but lands on /sign-in directly — an old bookmark, a shared
  // link — shouldn't have to log in again. Send them straight to their panel.
  useEffect(() => {
    api<AuthResult["user"]>("/auth/me")
      .then((user) => window.location.replace(landingFor(user.role)))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "create") {
        await api<AuthResult>("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            first_name: firstName, last_name: lastName, phone_number: phone,
            password, confirm_password: confirmPassword,
          }),
        });
        window.location.replace("/dashboard");
      } else {
        const result = await api<AuthResult>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ phone_number: phone, password }),
        });
        window.location.replace(landingFor(result.user.role));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Davom etib bo'lmadi.", "Unable to continue."));
      setLoading(false);
    }
  }

  function openTelegramSignIn() {
    const username = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "rgnmockimtihon_bot").replace(/^@/, "");
    // The bot opens directly, even when the API is offline or the phone field is empty.
    window.location.assign(`https://t.me/${encodeURIComponent(username)}?start=${tab === "create" ? "signup" : "signin"}`);
  }

  return (
    <div className="auth-card w-full max-w-md rounded-[28px] border border-line bg-canvas p-2 shadow-soft">
      <div className="grid grid-cols-2 rounded-2xl bg-surface p-1">
        <button onClick={() => { setTab("sign-in"); setError(""); }} className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === "sign-in" ? "bg-canvas text-ink shadow-sm" : "text-muted"}`}>{t("Kirish", "Sign In")}</button>
        <button onClick={() => { setTab("create"); setError(""); }} className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === "create" ? "bg-canvas text-ink shadow-sm" : "text-muted"}`}>{t("Ro'yxatdan o'tish", "Create Account")}</button>
      </div>
      <div className="auth-card-content px-5 pb-6 pt-7 sm:px-8">
        <div className="auth-intro mb-7">
          <p className="text-xs font-bold uppercase tracking-[.08em] text-brand">{tab === "sign-in" ? t("Xush kelibsiz", "Welcome back") : t("O'qishni boshlang", "Start learning")}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{tab === "sign-in" ? t("Davom ettiramiz", "Continue your progress") : t("Hisob yarating", "Create your account")}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{tab === "sign-in" ? t("Keyingi bosqich sizni kutmoqda.", "Your next milestone is waiting.") : t("Bir necha ma'lumot — va boshlashga tayyorsiz.", "A few details and you’re ready to begin.")}</p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {tab === "create" && (
            <div className="auth-name-fields grid grid-cols-2 gap-3">
              <label className="min-w-0 text-sm font-semibold text-ink"><span className="sr-only">{t("Ism", "First Name")}</span><Input className="min-w-0" placeholder={t("Ism", "First name")} value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label>
              <label className="min-w-0 text-sm font-semibold text-ink"><span className="sr-only">{t("Familiya", "Last Name")}</span><Input className="min-w-0" placeholder={t("Familiya", "Last name")} value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label>
            </div>
          )}
          <label className="block text-sm font-semibold text-ink">
            <span className="sr-only">{t("Telefon raqam", "Phone Number")}</span>
            <div className="flex">
              <span className="grid h-12 shrink-0 whitespace-nowrap place-items-center rounded-l-xl border border-r-0 border-line bg-surface px-3 text-sm font-bold text-ink">+998</span>
              <Input className="min-w-0 flex-1 rounded-l-none" inputMode="numeric" placeholder="90 123 45 67" value={phone} onChange={(event) => setPhone(event.target.value)} required />
            </div>
          </label>
          <div className={tab === "create" ? "auth-password-fields grid grid-cols-1 gap-3 sm:grid-cols-2" : ""}>
          <label className="block min-w-0 text-sm font-semibold text-ink">
            <span className="sr-only">{t("Parol", "Password")}</span>
            <div className="relative">
              <Input className="min-w-0 pr-10" type={showPassword ? "text" : "password"} placeholder={t("Parolingiz", "Your password")} value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t("Parolni yashirish", "Hide password") : t("Parolni ko'rsatish", "Show password")} aria-pressed={showPassword} className="absolute right-3 top-3 text-muted">{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
            </div>
          </label>
          {tab === "create" && (
            <label className="block min-w-0 text-sm font-semibold text-ink">
              <span className="sr-only">{t("Parolni tasdiqlang", "Confirm Password")}</span>
              <div className="relative">
                <Input className="min-w-0 pr-10" type={showConfirmPassword ? "text" : "password"} placeholder={t("Parolni takrorlang", "Repeat your password")} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? t("Takroriy parolni yashirish", "Hide repeat password") : t("Takroriy parolni ko'rsatish", "Show repeat password")} aria-pressed={showConfirmPassword} className="absolute right-3 top-3 text-muted">{showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
              </div>
            </label>
          )}
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
          {tab === "sign-in" && <div className="flex justify-end"><Link href="/forgot-password" className="text-sm font-semibold text-brand hover:underline">{t("Parolni unutdingizmi?", "Forgot password?")}</Link></div>}
          <Button className="w-full" size="lg" disabled={loading}>
            {loading ? t("Kuting…", "Please wait…") : tab === "sign-in" ? t("Kirish", "Sign In") : t("Ro'yxatdan o'tish", "Create Account")} {!loading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>
        {(
          <>
            <div className="auth-divider my-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-muted"><span className="h-px flex-1 bg-line" />{t("yoki xavfsiz davom eting", "or continue securely")}<span className="h-px flex-1 bg-line" /></div>
            <Button type="button" variant="secondary" className="w-full" size="lg" onClick={openTelegramSignIn} disabled={loading}><svg className="h-5 w-5 shrink-0 text-sky-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.44 3.62 18.2 20.1c-.24 1.16-.89 1.44-1.8.9l-4.94-3.64-2.38 2.29c-.26.26-.48.48-.98.48l.35-5.03 9.16-8.28c.4-.35-.09-.55-.62-.2L5.67 13.75.8 12.23c-1.06-.33-1.08-1.06.22-1.57L20.05 3.3c.88-.33 1.65.2 1.39.32Z" /></svg> {tab === "create" ? t("Telegram orqali ro'yxatdan o'tish", "Create account via Telegram") : t("Telegram orqali kirish", "Sign in via Telegram")}</Button>
          </>
        )}
        <div className="auth-security mt-6 flex items-center justify-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 text-emerald-500" /> {t("Ma'lumotlaringiz shifrlangan va himoyalangan", "Your data is encrypted and protected")}</div>
      </div>
    </div>
  );
}
