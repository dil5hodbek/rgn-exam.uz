"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  EntryShell, PasswordField, PhoneField, phoneComplete, phoneForApi, TelegramIcon,
} from "@/components/auth/entry-shell";
import { api, ApiError } from "@/lib/api";
import { useLang } from "@/lib/i18n";

type Step = "phone" | "code" | "password" | "done";
const BOT_FALLBACK = `https://t.me/${(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "rgnmockimtihon_bot").replace(/^@/, "")}`;

/** Password reset in the sign-in design: phone → code from the Registon bot → new password. */
export default function ForgotPassword() {
  const { t } = useLang();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [botUrl, setBotUrl] = useState(BOT_FALLBACK);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (!phoneComplete(phone)) {
      setError(t("Telefon raqamini to‘liq kiriting: 90 000 00 00.", "Enter the full phone number: 90 000 00 00."));
      return;
    }
    setError("");
    setLoading(true);
    // Open the tab inside the click, so the browser does not block it as a pop-up.
    const first = step === "phone";
    const tab = first ? window.open("about:blank", "_blank") : null;
    try {
      const result = await api<{ bot_url?: string | null }>("/auth/telegram/request-otp", {
        method: "POST",
        body: JSON.stringify({ phone_number: phoneForApi(phone), purpose: "reset" }),
      });
      const url = result.bot_url || BOT_FALLBACK;
      setBotUrl(url);
      if (tab) { tab.opener = null; tab.location.href = url; }
      setStep("code");
      setCooldown(60);
    } catch (reason) {
      tab?.close();
      setError(reason instanceof ApiError && reason.status === 429
        ? t("Kod yaqinda yuborildi. Bir daqiqadan keyin qayta urinib ko‘ring.", "A code was sent recently. Try again in a minute.")
        : reason instanceof Error ? reason.message : t("Kodni so‘rab bo‘lmadi.", "Unable to request the code."));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (code.length !== 5) {
      setError(t("Botdan kelgan 5 xonali kodni kiriting.", "Enter the 5-digit code from the bot."));
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await api<{ reset_token: string }>("/auth/telegram/verify-otp", {
        method: "POST",
        body: JSON.stringify({ phone_number: phoneForApi(phone), code, purpose: "reset" }),
      });
      setResetToken(result.reset_token);
      setStep("password");
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 429
        ? t("Urinishlar ko‘p bo‘ldi. Yangi kod so‘rang.", "Too many attempts. Request a new code.")
        : reason instanceof ApiError && reason.status === 401
          ? t("Kod noto‘g‘ri yoki eskirgan. Botdagi oxirgi kodni kiriting.", "The code is wrong or expired. Enter the latest code from the bot.")
          : reason instanceof Error ? reason.message : t("Kod noto‘g‘ri.", "Incorrect code."));
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!password) {
      setError(t("Yangi parolni kiriting.", "Enter a new password."));
      return;
    }
    if (password !== confirmation) {
      setError(t("Parollar bir xil emas.", "The passwords do not match."));
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api("/auth/forgot-password/reset", {
        method: "POST",
        body: JSON.stringify({ reset_token: resetToken, password, confirm_password: confirmation }),
      });
      setStep("done");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setStep("phone");
        setCode("");
        setError(t("Tiklash vaqti tugadi. Kodni qaytadan oling.", "The reset session expired. Get a new code."));
      } else {
        setError(reason instanceof Error ? reason.message : t("Parolni tiklab bo‘lmadi.", "Unable to reset the password."));
      }
    } finally {
      setLoading(false);
    }
  }

  function changePhone() {
    setStep("phone");
    setCode("");
    setError("");
  }

  const titles: Record<Step, string> = {
    phone: t("Parolni tiklash", "Reset your password"),
    code: t("Telegramni tekshiring", "Check Telegram"),
    password: t("Yangi parol o‘rnating", "Set a new password"),
    done: t("Parol yangilandi", "Password updated"),
  };

  return <EntryShell>
    <h2>{titles[step]}</h2>

    {step === "phone" && <form className="phone-login" onSubmit={requestCode} noValidate>
      <p className="entry-hint">{t("Hisobingizga bog‘langan telefon raqamini kiriting. Tasdiqlash kodi Registon Telegram botiga keladi.", "Enter the phone number on your account. The code will arrive in the Registon Telegram bot.")}</p>
      <PhoneField value={phone} onChange={setPhone} autoComplete="tel-national"
        label={t("Telefon raqami", "Phone number")} placeholder="90 000 00 00" />
      <button className="phone-submit" type="submit" disabled={loading}>{loading ? t("Yuborilmoqda…", "Sending…") : t("Kodni olish", "Get the code")}</button>
      {error && <p className="login-error" role="alert">{error}</p>}
    </form>}

    {step === "code" && <form className="phone-login" onSubmit={verifyCode} noValidate>
      <p className="entry-hint">
        {t("Botni oching, Start ni bosing va telefon raqamingizni yuboring. Bot sizga 5 xonali kod yuboradi:", "Open the bot, tap Start and share your phone number. The bot will send you a 5-digit code:")}
        {" "}<b>+998 {phone}</b>
      </p>
      <a className="telegram-button" href={botUrl} target="_blank" rel="noreferrer">
        <TelegramIcon />
        {t("Registon botini ochish", "Open the Registon bot")}
      </a>
      <div className="demo-input code-input">
        <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={5} placeholder="00000"
          aria-label={t("Tasdiqlash kodi", "Verification code")} value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 5))} required />
      </div>
      <button className="phone-submit" type="submit" disabled={loading || code.length !== 5}>{loading ? t("Tekshirilmoqda…", "Checking…") : t("Kodni tasdiqlash", "Verify the code")}</button>
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="login-links">
        <button type="button" className="link-button" onClick={() => requestCode()} disabled={loading || cooldown > 0}>
          {cooldown > 0 ? t(`Qayta yuborish: ${cooldown} s`, `Resend in ${cooldown}s`) : t("Kodni qayta yuborish", "Resend the code")}
        </button>
        <button type="button" className="link-button" onClick={changePhone} disabled={loading}>{t("Raqamni o‘zgartirish", "Change the number")}</button>
      </div>
    </form>}

    {step === "password" && <form className="phone-login" onSubmit={savePassword} noValidate>
      <p className="entry-hint">{t("Hisobingiz uchun yangi parol tanlang.", "Choose a new password for your account.")}</p>
      <PasswordField value={password} onChange={setPassword} autoComplete="new-password"
        label={t("Yangi parol", "New password")} placeholder={t("Yangi parol", "New password")}
        showLabel={t("Parolni ko‘rsatish", "Show password")} hideLabel={t("Parolni yashirish", "Hide password")} />
      <PasswordField value={confirmation} onChange={setConfirmation} autoComplete="new-password"
        label={t("Yangi parolni takrorlang", "Repeat the new password")} placeholder={t("Yangi parolni takrorlang", "Repeat the new password")}
        showLabel={t("Takroriy parolni ko‘rsatish", "Show repeated password")} hideLabel={t("Takroriy parolni yashirish", "Hide repeated password")} />
      <button className="phone-submit" type="submit" disabled={loading}>{loading ? t("Saqlanmoqda…", "Saving…") : t("Yangi parolni saqlash", "Save the new password")}</button>
      {error && <p className="login-error" role="alert">{error}</p>}
    </form>}

    {step === "done" && <div className="phone-login">
      <p className="entry-hint">{t("Parolingiz o‘zgartirildi. Endi yangi parol bilan kirishingiz mumkin.", "Your password has been changed. You can now sign in with the new password.")}</p>
      <Link className="phone-submit" href="/sign-in">{t("Kirish", "Sign in")}</Link>
    </div>}

    {step !== "done" && <p className="signup-switch">{t("Parol esingizga tushdimi?", "Remembered your password?")} <Link href="/sign-in">{t("Kirish", "Sign in")}</Link></p>}
  </EntryShell>;
}
