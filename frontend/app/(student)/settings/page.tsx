"use client";

import { useEffect, useState } from "react";
import { Bot, Check, KeyRound, Monitor, Moon, Save, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

type Me = { first_name: string; last_name: string; phone_number: string; theme: string; telegram_linked: boolean };

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  useEffect(() => { api<Me>("/auth/me").then(setMe).catch((reason) => setError(String(reason))); }, []);

  async function saveProfile() {
    if (!me) return;
    setError("");
    try {
      const updated = await api<Me>("/auth/me", { method: "PATCH", body: JSON.stringify({ first_name: me.first_name, last_name: me.last_name, theme: theme ?? "system" }) });
      setMe(updated); setMessage("Profile saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save profile."); }
  }
  async function linkTelegram() {
    setError(""); setMessage("Opening Telegram. Share your contact with the bot.");
    try {
      const link = await api<{ token: string; deep_link: string }>("/auth/telegram/link/start", { method: "POST" });
      window.open(link.deep_link, "_blank", "noopener,noreferrer");
      let attempts = 0;
      const poll = window.setInterval(async () => {
        attempts += 1;
        try {
          await api(`/auth/telegram/link/complete?token=${encodeURIComponent(link.token)}`, { method: "POST" });
          window.clearInterval(poll);
          setMe((value) => value ? { ...value, telegram_linked: true } : value);
          setMessage("Telegram linked successfully.");
        } catch {
          if (attempts >= 40) { window.clearInterval(poll); setError("Linking timed out. Request a new link."); }
        }
      }, 3000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to start Telegram linking."); }
  }
  async function unlinkTelegram() {
    await api("/auth/telegram/link", { method: "DELETE" });
    setMe((value) => value ? { ...value, telegram_linked: false } : value);
    setMessage("Telegram unlinked.");
  }
  async function changePassword() {
    setError("");
    try {
      const result = await api<{ message: string }>("/auth/me/password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setMessage(result.message); setCurrentPassword(""); setNewPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to change password."); }
  }

  if (!me) return <div className="grid min-h-[70vh] place-items-center"><span className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-brand" /></div>;
  return <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Your account</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Settings</h1><p className="mt-2 text-sm text-muted">Manage your profile, Telegram, password, and appearance.</p>
    {message && <p className="mt-5 rounded-xl bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700">{message}</p>}{error && <p className="mt-5 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    <div className="mt-8 space-y-5"><section className="rounded-3xl border border-line bg-canvas p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500"><UserRound className="h-5 w-5" /></span><div><h2 className="font-extrabold text-ink">Personal information</h2><p className="text-xs text-muted">Phone changes require a separate verification flow.</p></div></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm font-bold text-ink">First Name<Input value={me.first_name} onChange={(event) => setMe({ ...me, first_name: event.target.value })} /></label><label className="space-y-2 text-sm font-bold text-ink">Last Name<Input value={me.last_name} onChange={(event) => setMe({ ...me, last_name: event.target.value })} /></label><label className="space-y-2 text-sm font-bold text-ink sm:col-span-2">Phone Number<Input value={me.phone_number} disabled /></label></div><div className="mt-5 flex justify-end"><Button onClick={saveProfile}><Save className="h-4 w-4" /> Save Changes</Button></div></section>
      <section className="rounded-3xl border border-line bg-canvas p-6"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-500"><Bot className="h-5 w-5" /></span><div><h2 className="font-extrabold text-ink">Telegram</h2><p className="text-xs text-muted">Verified contact linking enables OTP sign-in.</p></div></div>{me.telegram_linked && <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600"><Check className="h-3 w-3" /> Linked</span>}</div><Button variant="secondary" className="mt-5" onClick={me.telegram_linked ? unlinkTelegram : linkTelegram}>{me.telegram_linked ? "Unlink Telegram" : "Link Telegram"}</Button></section>
      <section className="rounded-3xl border border-line bg-canvas p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/10 text-orange-500"><Sun className="h-5 w-5" /></span><div><h2 className="font-extrabold text-ink">Appearance</h2><p className="text-xs text-muted">Choose how ExamFlow looks.</p></div></div><div className="mt-5 grid grid-cols-3 gap-3">{[{ name: "light", icon: Sun }, { name: "dark", icon: Moon }, { name: "system", icon: Monitor }].map((option) => <button key={option.name} onClick={() => setTheme(option.name)} className={cn("flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-bold capitalize transition", theme === option.name ? "border-brand bg-indigo-500/5 text-brand ring-2 ring-indigo-500/10" : "border-line text-muted hover:bg-surface")}><option.icon className="h-5 w-5" />{option.name}</button>)}</div></section>
      <section className="rounded-3xl border border-line bg-canvas p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500"><KeyRound className="h-5 w-5" /></span><div><h2 className="font-extrabold text-ink">Change password</h2><p className="text-xs text-muted">At least eight characters with a letter and number.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Input type="password" placeholder="Current password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /><Input type="password" placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div><Button variant="secondary" className="mt-4" onClick={changePassword}>Change Password</Button></section>
    </div></div>;
}
