"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import "../settings.css";

type Me = { first_name: string; last_name: string; phone_number: string };

export default function ProfileSettingsPage() {
  const { theme } = useTheme();
  const { t } = useLang();
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { api<Me>("/auth/me").then(setMe).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!me) return;
    setError(""); setMessage(""); setSaving(true);
    try {
      const updated = await api<Me>("/auth/me", { method: "PATCH", body: JSON.stringify({ first_name: me.first_name, last_name: me.last_name, theme: theme ?? "system" }) });
      setMe(updated); setMessage(t("Profil saqlandi.", "Profile saved."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Profilni saqlab bo'lmadi.", "Unable to save profile.")); }
    finally { setSaving(false); }
  }

  return <div className="settings-page">
    <Link href="/settings" className="settings-back"><ArrowLeft size={16} />{t("Sozlamalar", "Settings")}</Link>
    <div className="settings-heading"><div><h1>{t("Shaxsiy ma'lumotlar", "Personal information")}</h1></div></div>
    {message && <p role="status" className="settings-notice">{message}</p>}
    {error && <p role="alert" className="settings-notice settings-error">{error}</p>}
    {!me && !error && <div className="grid min-h-[30vh] place-items-center" role="status"><span className="h-8 w-8 animate-spin rounded-full border-4 border-orange-100 border-t-brand" /></div>}
    {me && <form className="settings-group settings-subpage-card" onSubmit={saveProfile}>
      <div className="settings-fields">
        <label>{t("Ism", "First name")}<Input autoComplete="given-name" value={me.first_name} onChange={(event) => setMe({ ...me, first_name: event.target.value })} required /></label>
        <label>{t("Familiya", "Last name")}<Input autoComplete="family-name" value={me.last_name} onChange={(event) => setMe({ ...me, last_name: event.target.value })} required /></label>
        <label className="settings-wide">{t("Telefon raqam", "Phone number")}<Input value={me.phone_number} disabled /></label>
      </div>
      <Button type="submit" className="settings-save" disabled={saving}><Save size={16} />{saving ? t("Saqlanmoqda…", "Saving…") : t("Saqlash", "Save changes")}</Button>
    </form>}
  </div>;
}
