"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ChevronRight, Check, Copy, Languages, LogOut, KeyRound, Monitor, Moon, Save, Sun, Trash2, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import "./settings.css";
import { ApiError, api, mediaUrl } from "@/lib/api";

type Me = {
  first_name: string; last_name: string; phone_number: string; theme: string;
  avatar_url: string | null; telegram_linked: boolean;
};

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      await api("/auth/logout", { method: "POST" });
      window.location.replace("/sign-in");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Chiqib bo'lmadi. Qayta urinib ko'ring.", "Unable to sign out. Please try again."));
      setSigningOut(false);
    }
  }
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [linking, setLinking] = useState(false);
  const [blockedLink, setBlockedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const telegramPollRef = useRef<number | null>(null);
  useEffect(() => () => { if (telegramPollRef.current) window.clearInterval(telegramPollRef.current); }, []);

  async function uploadAvatar(file: File) {
    setError(""); setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await api<Me>("/auth/me/avatar", { method: "POST", body: form });
      setMe(updated); setMessage(t("Profil rasmi yangilandi.", "Profile picture updated."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Rasmni yuklab bo'lmadi.", "Unable to upload the picture."));
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }
  async function removeAvatar() {
    setError("");
    try {
      const updated = await api<Me>("/auth/me/avatar", { method: "DELETE" });
      setMe(updated); setMessage(t("Profil rasmi o'chirildi.", "Profile picture removed."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Rasmni o'chirib bo'lmadi.", "Unable to remove the picture.")); }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(blockedLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }
  const [newPassword, setNewPassword] = useState("");
  useEffect(() => { api<Me>("/auth/me").then(setMe).catch((reason) => setError(String(reason))); }, []);

  async function saveProfile() {
    if (!me) return;
    setError("");
    try {
      const updated = await api<Me>("/auth/me", { method: "PATCH", body: JSON.stringify({ first_name: me.first_name, last_name: me.last_name, theme: theme ?? "system" }) });
      setMe(updated); setMessage(t("Profil saqlandi.", "Profile saved."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Profilni saqlab bo'lmadi.", "Unable to save profile.")); }
  }
  async function linkTelegram() {
    if (linking) return;
    setError(""); setBlockedLink(""); setLinking(true); setMessage(t("Telegram ochilmoqda. Telefon raqamingizni yuboring va shu yerga qayting.", "Opening Telegram. Share your phone number, then return here."));
    try {
      const link = await api<{ token: string; deep_link: string }>("/auth/telegram/link/start", { method: "POST" });
      const telegramWindow = window.open(link.deep_link, "_blank", "noopener,noreferrer");
      if (!telegramWindow) { setMessage(t("Quyidagi havola orqali Telegramni oching.", "Open Telegram using the link below.")); setBlockedLink(link.deep_link); }
      let attempts = 0;
      let inFlight = false;
      const poll = window.setInterval(async () => {
        if (inFlight) return;
        inFlight = true;
        attempts += 1;
        try {
          const result = await api<{ message: string }>(`/auth/telegram/link/complete?token=${encodeURIComponent(link.token)}`, { method: "POST" });
          window.clearInterval(poll); telegramPollRef.current = null;
          setMe(value => value ? { ...value, telegram_linked: true } : value);
          setLinking(false); setBlockedLink(""); setMessage(result.message);
        } catch (reason) {
          if (reason instanceof ApiError && reason.status !== 409) {
            window.clearInterval(poll); telegramPollRef.current = null; setLinking(false); setError(reason.message);
          } else if (attempts >= 100) {
            window.clearInterval(poll); telegramPollRef.current = null; setLinking(false); setError(t("Telegram havolasining muddati tugadi. Qayta urinib ko'ring.", "The Telegram link expired. Please try again."));
          }
        } finally { inFlight = false; }
      }, 3000);
      telegramPollRef.current = poll;
    } catch (reason) { setLinking(false); setError(reason instanceof Error ? reason.message : t("Telegramni ulashni boshlab bo'lmadi.", "Unable to start Telegram linking.")); }
  }
  async function unlinkTelegram() {
    setError("");
    try {
      await api("/auth/telegram/link", { method: "DELETE" });
      setMe(value => value ? { ...value, telegram_linked: false } : value);
      setMessage(t("Telegram uzildi.", "Telegram unlinked."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Telegramni uzib bo'lmadi.", "Unable to unlink Telegram.")); }
  }
  async function changePassword() {
    setError("");
    try {
      const result = await api<{ message: string }>("/auth/me/password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setMessage(result.message); setCurrentPassword(""); setNewPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Parolni o'zgartirib bo'lmadi.", "Unable to change password.")); }
  }

  if (!me) return <div className="grid min-h-[50vh] place-items-center" role="status" aria-label={t("Sozlamalar yuklanmoqda", "Loading settings")}><span className="h-8 w-8 animate-spin rounded-full border-4 border-orange-100 border-t-brand" /></div>;
  const fullName = `${me.first_name} ${me.last_name}`.trim();
  return <div className="settings-page">
    <div className="settings-heading"><div><p>{t("Hisobingiz", "Your account")}</p><h1>{t("Sozlamalar", "Settings")}</h1></div><button className="settings-signout-top" onClick={signOut} disabled={signingOut}><LogOut size={16}/>{signingOut ? t("Chiqilmoqda…", "Signing out…") : t("Chiqish", "Sign Out")}</button></div>
    {message && <p role="status" className="settings-notice">{message}</p>}
    {error && <p role="alert" className="settings-notice settings-error">{error}</p>}
    <section className="settings-profile" aria-label={t("Profilingiz", "Your profile")}>
      <div className="settings-profile-wash"/>
      <button type="button" className="settings-avatar" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()} aria-label={t("Profil rasmini o'zgartirish", "Change profile picture")}>
        {me.avatar_url ? <img src={mediaUrl(me.avatar_url)} alt="" /> : <span>{`${me.first_name[0] ?? ""}${me.last_name[0] ?? ""}`.toUpperCase()}</span>}
        <span className="settings-camera"><Camera size={14}/></span>
      </button>
      <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAvatar(file); }} />
      <h2>{fullName}</h2><p>{me.phone_number}</p>
      <button type="button" className="settings-photo-action" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()}>{avatarUploading ? t("Yuklanmoqda…", "Uploading…") : t("Profil rasmini o'zgartirish", "Change profile photo")}</button>
      {me.avatar_url && <button type="button" className="settings-remove-photo" onClick={removeAvatar}><Trash2 size={13}/>{t("Rasmni o'chirish", "Remove photo")}</button>}
    </section>
    <p className="settings-group-label">{t("Hisob", "Account")}</p>
    <div className="settings-group">
      <details className="settings-details">
        <summary className="settings-row"><span className="settings-row-icon settings-orange"><UserRound size={19}/></span><span className="settings-row-copy"><strong>{t("Shaxsiy ma'lumotlar", "Personal information")}</strong><small>{t("Ism va telefon raqam", "Name and phone number")}</small></span><ChevronRight className="settings-chevron" size={18}/></summary>
        <div className="settings-expanded"><div className="settings-fields"><label>{t("Ism", "First name")}<Input autoComplete="given-name" value={me.first_name} onChange={(event) => setMe({ ...me, first_name: event.target.value })}/></label><label>{t("Familiya", "Last name")}<Input autoComplete="family-name" value={me.last_name} onChange={(event) => setMe({ ...me, last_name: event.target.value })}/></label><label className="settings-wide">{t("Telefon raqam", "Phone number")}<Input value={me.phone_number} disabled/></label></div><Button className="settings-save" onClick={saveProfile}><Save size={16}/>{t("Saqlash", "Save changes")}</Button></div>
      </details>
      <section aria-label={t("Telegram ulanishi", "Telegram connection")}>
        <div className="settings-row"><span className="settings-row-icon settings-telegram"><svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.44 3.62 18.2 20.1c-.24 1.16-.89 1.44-1.8.9l-4.94-3.64-2.38 2.29c-.26.26-.48.48-.98.48l.35-5.03 9.16-8.28c.4-.35-.09-.55-.62-.2L5.67 13.75.8 12.23c-1.06-.33-1.08-1.06.22-1.57L20.05 3.3c.88-.33 1.65.2 1.39.32Z"/></svg></span><span className="settings-row-copy"><strong>Telegram</strong><small>{linking ? t("Ulanish kutilmoqda…", "Waiting for connection…") : me.telegram_linked ? t("Ulangan · xavfsiz kirish", "Connected · secure sign-in") : t("Tez kirish uchun ulang", "Connect for quick sign-in")}</small></span><span className={cn("settings-connection", me.telegram_linked && "is-connected")}>{me.telegram_linked ? <><Check size={13}/>{t("Ulangan", "Linked")}</> : t("Ulanmagan", "Not linked")}</span></div>
        <div className="settings-telegram-action"><button type="button" disabled={linking} onClick={me.telegram_linked ? unlinkTelegram : linkTelegram}>{linking ? t("Telegram kutilmoqda…", "Waiting for Telegram…") : me.telegram_linked ? t("Telegramni uzish", "Disconnect Telegram") : t("Telegramni ulash", "Connect Telegram")}<ChevronRight size={15}/></button></div>
      </section>
      <details className="settings-details">
        <summary className="settings-row"><span className="settings-row-icon settings-security"><KeyRound size={19}/></span><span className="settings-row-copy"><strong>{t("Parol va xavfsizlik", "Password & security")}</strong><small>{t("Parolni o'zgartirish", "Change your password")}</small></span><ChevronRight className="settings-chevron" size={18}/></summary>
        <form className="settings-expanded" onSubmit={(event) => { event.preventDefault(); changePassword(); }}><p className="settings-help">{t("Kamida 8 ta belgi, ichida harf va raqam bo'lsin.", "Use at least eight characters with a letter and number.")}</p><div className="settings-fields"><label>{t("Joriy parol", "Current password")}<Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required/></label><label>{t("Yangi parol", "New password")}<Input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required/></label></div><Button type="submit" className="settings-save">{t("Parolni o'zgartirish", "Change password")}</Button></form>
      </details>
    </div>
    {blockedLink && <div className="settings-notice settings-link-fallback"><a href={blockedLink} target="_blank" rel="noreferrer">{t("Telegramni ochish", "Open Telegram")}</a><Button size="sm" variant="secondary" onClick={copyLink}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? t("Nusxalandi", "Copied") : t("Havolani nusxalash", "Copy link")}</Button></div>}
    <p className="settings-group-label">{t("Til", "Language")}</p>
    <section className="settings-group" aria-label={t("Til", "Language")}><div className="settings-theme-options" role="radiogroup" aria-label={t("Interfeys tili", "Interface language")}>{([{ name: "uz", title: "O'zbekcha", hint: "Interfeys o'zbek tilida" }, { name: "en", title: "English", hint: "Interface in English" }] as const).map((option) => <label key={option.name} className={cn("settings-row settings-theme-row", lang === option.name && "is-selected")}><input className="sr-only" type="radio" name="interface-language" value={option.name} checked={lang === option.name} onChange={() => setLang(option.name)} /><span className="settings-row-icon settings-orange"><Languages size={19}/></span><span className="settings-row-copy"><strong>{option.title}</strong><small>{option.hint}</small></span><span className="settings-radio">{lang === option.name && <Check size={13}/>}</span></label>)}</div></section>
    <p className="settings-group-label">{t("Ko'rinish", "Appearance")}</p>
    <section className="settings-group" aria-label={t("Ko'rinish", "Appearance")}><div className="settings-theme-options" role="radiogroup" aria-label={t("Rang mavzusi", "Color theme")}>{[{ name: "light", title: t("Yorug'", "Light"), hint: t("Toza va yorqin ko'rinish", "A clean, bright look"), icon: Sun }, { name: "dark", title: t("Qorong'i", "Dark"), hint: t("Kam yorug'likda qulay", "Comfortable in low light"), icon: Moon }, { name: "system", title: t("Tizim", "System"), hint: t("Qurilmangizga moslashadi", "Match your device"), icon: Monitor }].map((option) => <label key={option.name} className={cn("settings-row settings-theme-row", theme === option.name && "is-selected")}><input className="sr-only" type="radio" name="color-theme" value={option.name} checked={theme === option.name} onChange={() => setTheme(option.name)} /><span className="settings-row-icon settings-orange"><option.icon size={19}/></span><span className="settings-row-copy"><strong>{option.title}</strong><small>{option.hint}</small></span><span className="settings-radio">{theme === option.name && <Check size={13}/>}</span></label>)}</div></section>
    <p className="settings-caption">REGISTON · {t("O'quv makoningiz", "Your learning space")}</p>
  </div>;
}
