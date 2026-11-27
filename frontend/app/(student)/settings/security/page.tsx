"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import "../settings.css";

export default function SecuritySettingsPage() {
  const { t } = useLang();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const result = await api<{ message: string }>("/auth/me/password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setMessage(result.message); setCurrentPassword(""); setNewPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Parolni o'zgartirib bo'lmadi.", "Unable to change password.")); }
    finally { setSaving(false); }
  }

  return <div className="settings-page">
    <Link href="/settings" className="settings-back"><ArrowLeft size={16} />{t("Sozlamalar", "Settings")}</Link>
    <div className="settings-heading"><div><h1>{t("Parol va xavfsizlik", "Password & security")}</h1></div></div>
    {message && <p role="status" className="settings-notice">{message}</p>}
    {error && <p role="alert" className="settings-notice settings-error">{error}</p>}
    <form className="settings-group settings-subpage-card" onSubmit={changePassword}>
      <div className="settings-fields">
        <label>{t("Joriy parol", "Current password")}<Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
        <label>{t("Yangi parol", "New password")}<Input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
      </div>
      <Button type="submit" className="settings-save" disabled={saving}>{saving ? t("Saqlanmoqda…", "Saving…") : t("Parolni o'zgartirish", "Change password")}</Button>
    </form>
  </div>;
}
