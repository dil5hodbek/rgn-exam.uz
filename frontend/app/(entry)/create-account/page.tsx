"use client";
import { useState } from "react";
import Link from "next/link";
import {
  EntryShell, openTelegram, PasswordField, PhoneField, phoneComplete, phoneForApi, TelegramIcon, useRedirectIfSignedIn,
} from "@/components/auth/entry-shell";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export default function CreateAccount() {
  const { t } = useLang();
  useRedirectIfSignedIn();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError(t("Ism va familiyani kiriting.", "Enter your first and last name."));
      return;
    }
    if (!phoneComplete(phone)) {
      setError(t("Telefon raqamini to‘liq kiriting: 90 000 00 00.", "Enter the full phone number: 90 000 00 00."));
      return;
    }
    if (!password) {
      setError(t("Parolni kiriting.", "Enter a password."));
      return;
    }
    if (password !== confirmation) {
      setError(t("Parollar bir xil emas.", "The passwords do not match."));
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          first_name: firstName.trim(), last_name: lastName.trim(), phone_number: phoneForApi(phone),
          password, confirm_password: confirmation,
        }),
      });
      window.location.replace("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Hisob yaratib bo‘lmadi.", "Unable to create the account."));
      setLoading(false);
    }
  }

  return <EntryShell>
    <h2>{t("Ro‘yxatdan o‘tish", "Create an account")}</h2>
    <button className="telegram-button" type="button" onClick={() => openTelegram("signup")} disabled={loading}>
      <TelegramIcon />
      {t("Telegram orqali ro‘yxatdan o‘tish", "Sign up with Telegram")}
    </button>
    <p className="login-divider">{t("yoki", "or")}</p>
    <form className="phone-login" onSubmit={submit} noValidate>
      <div className="name-fields">
        <div className="demo-input">
          <input type="text" autoComplete="given-name" maxLength={64} aria-label={t("Ism", "First name")}
            placeholder={t("Ism", "First name")} value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
        </div>
        <div className="demo-input">
          <input type="text" autoComplete="family-name" maxLength={64} aria-label={t("Familiya", "Last name")}
            placeholder={t("Familiya", "Last name")} value={lastName} onChange={(event) => setLastName(event.target.value)} required />
        </div>
      </div>
      <PhoneField value={phone} onChange={setPhone} autoComplete="tel-national"
        label={t("Telefon raqami", "Phone number")} placeholder="90 000 00 00" />
      <PasswordField value={password} onChange={setPassword} autoComplete="new-password"
        label={t("Parol", "Password")} placeholder={t("Parolni kiriting", "Enter a password")}
        showLabel={t("Parolni ko‘rsatish", "Show password")} hideLabel={t("Parolni yashirish", "Hide password")} />
      <PasswordField value={confirmation} onChange={setConfirmation} autoComplete="new-password"
        label={t("Parolni takrorlang", "Repeat the password")} placeholder={t("Parolni takrorlang", "Repeat the password")}
        showLabel={t("Takroriy parolni ko‘rsatish", "Show repeated password")} hideLabel={t("Takroriy parolni yashirish", "Hide repeated password")} />
      <button className="phone-submit" type="submit" disabled={loading}>{loading ? t("Hisob yaratilmoqda…", "Creating your account…") : t("Hisob yaratish", "Create account")}</button>
      {error && <p className="login-error" role="alert">{error}</p>}
    </form>
    <p className="signup-switch">{t("Hisobingiz bormi?", "Already have an account?")} <Link href="/sign-in">{t("Kirish", "Sign in")}</Link></p>
  </EntryShell>;
}
