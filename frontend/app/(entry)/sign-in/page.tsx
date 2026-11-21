"use client";
import { useState } from "react";
import Link from "next/link";
import {
  EntryShell, landingFor, openTelegram, PasswordField, PhoneField, phoneComplete, phoneForApi, TelegramIcon,
  useRedirectIfSignedIn, type AuthResult,
} from "@/components/auth/entry-shell";
import { api, ApiError } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export default function SignIn() {
  const { t } = useLang();
  useRedirectIfSignedIn();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!phoneComplete(phone)) {
      setError(t("Telefon raqamini to‘liq kiriting (90 000 00 00) yoki username yozing.", "Enter the full phone number (90 000 00 00) or your username."));
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await api<AuthResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone_number: phoneForApi(phone), password }),
      });
      window.location.replace(landingFor(result.user.role));
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 401
        ? t("Telefon raqami, username yoki parol noto‘g‘ri.", "Incorrect phone number, username or password.")
        : reason instanceof Error ? reason.message : t("Kirib bo‘lmadi.", "Unable to sign in."));
      setPassword("");
      setLoading(false);
    }
  }

  return <EntryShell>
    <h2>{t("Hisobingizga kirish", "Sign in to your account")}</h2>
    <form className="phone-login" onSubmit={submit} noValidate>
      <PhoneField allowUsername value={phone} onChange={setPhone} autoComplete="username"
        label={t("Telefon raqami yoki username", "Phone number or username")}
        placeholder={t("90 000 00 00 yoki username", "90 000 00 00 or username")} />
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password"
        label={t("Parol", "Password")} placeholder={t("Parolni kiriting", "Enter your password")}
        showLabel={t("Parolni ko‘rsatish", "Show password")} hideLabel={t("Parolni yashirish", "Hide password")} />
      <button className="phone-submit" type="submit" disabled={loading}>{loading ? t("Kirilmoqda…", "Signing in…") : t("Kirish", "Sign in")}</button>
      {error && <p className="login-error" role="alert">{error}</p>}
    </form>
    <div className="login-links">
      <Link href="/create-account">{t("Ro‘yxatdan o‘tish", "Create an account")}</Link>
      <Link href="/forgot-password">{t("Parolni unutdingizmi?", "Forgot password?")}</Link>
    </div>
    <p className="login-divider">{t("yoki", "or")}</p>
    <button className="telegram-button" type="button" onClick={() => openTelegram("signin")} disabled={loading}>
      <TelegramIcon />
      {t("Telegram orqali kirish", "Sign in with Telegram")}
    </button>
  </EntryShell>;
}
