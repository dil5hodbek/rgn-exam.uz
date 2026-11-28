"use client";
import { Check, Copy, ExternalLink, MonitorSmartphone, Share, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { fullscreenSupported } from "@/components/exam/use-exam-lockdown";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { chromeIntent, detectBrowser, type BrowserEnv } from "@/lib/browser-env";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Shown before an exam starts when this browser can't go fullscreen:
 *  - an app's built-in browser (Telegram…): one tap reopens the exam in
 *    Chrome, still signed in (a single-use hand-off code), or copy the link;
 *  - iPhone: Apple allows no fullscreen for websites, so explain the
 *    home-screen app, which opens without any browser bars.
 * Nothing is shown where fullscreen works.
 */
export function BrowserAdvice({ className }: { className?: string }) {
  const { t } = useLang();
  const [env, setEnv] = useState<BrowserEnv | null>(null);
  const [canFullscreen, setCanFullscreen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEnv(detectBrowser()); setCanFullscreen(fullscreenSupported()); }, []);
  if (!env || env.standalone) return null;

  async function openInChrome() {
    setBusy(true);
    setError("");
    try {
      const next = window.location.pathname + window.location.search;
      const { code } = await api<{ code: string }>("/auth/handoff", { method: "POST" });
      const target = `${window.location.origin}/continue?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`;
      window.location.href = chromeIntent(target);
      setTimeout(() => setBusy(false), 2500);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError(window.location.href); }
  }

  const box = cn("rounded-2xl border p-4 text-left", className);
  if (env.inApp) {
    const app = env.inApp === "app" ? t("ilova", "the app") : env.inApp;
    return <div className={cn(box, "border-amber-500/40 bg-amber-500/10")}>
      <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><MonitorSmartphone className="h-4 w-4 shrink-0 text-amber-600" />{t("To‘liq ekran bu yerda ishlamaydi", "Fullscreen doesn't work here")}</p>
      <p className="mt-1.5 text-xs leading-5 text-muted">{env.os === "ios"
        ? t(`Siz ${app} ichidagi brauzerdasiz. Imtihonni Safari'da oching: pastdagi yoki tepadagi menyudan «Safari'da ochish»ni tanlang.`, `You're in ${app}'s built-in browser. Open the exam in Safari: choose “Open in Safari” from its menu.`)
        : t(`Siz ${app} ichidagi brauzerdasiz. Imtihonni Chrome'da oching — u yerda ekran to‘liq bo‘ladi.`, `You're in ${app}'s built-in browser. Open the exam in Chrome — it goes fullscreen there.`)}</p>
      <div className="mt-3 grid gap-2">
        {env.os === "android" && <Button size="sm" className="w-full" disabled={busy} onClick={openInChrome}><ExternalLink className="h-4 w-4" />{busy ? t("Ochilmoqda…", "Opening…") : t("Chrome'da ochish", "Open in Chrome")}</Button>}
        <Button size="sm" variant="secondary" className="w-full" onClick={copyLink}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? t("Nusxalandi", "Copied") : t("Havolani nusxalash", "Copy link")}</Button>
      </div>
      {env.os === "android" && <p className="mt-2 text-[11px] leading-4 text-muted">{t("Ochilmasa: tepadagi ⋮ menyusi → «Brauzerda ochish».", "If nothing opens: the ⋮ menu at the top → “Open in browser”.")}</p>}
      {error && <p role="alert" className="mt-2 break-all text-xs font-semibold text-red-600">{error}</p>}
    </div>;
  }
  if (env.os === "ios" && !canFullscreen) {
    return <div className={cn(box, "border-line bg-surface")}>
      <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><MonitorSmartphone className="h-4 w-4 shrink-0 text-brand" />{t("iPhone'da to‘liq ekran", "Fullscreen on iPhone")}</p>
      <p className="mt-1.5 text-xs leading-5 text-muted">{t("Apple saytlarga to‘liq ekranni bermaydi. Brauzer panellarisiz ishlash uchun saytni ilova qilib qo‘shing:", "Apple doesn't let websites go fullscreen. To work without browser bars, add the site as an app:")}</p>
      <ol className="mt-2 space-y-1.5 text-xs font-semibold text-ink">
        <li className="flex items-center gap-2"><Share className="h-3.5 w-3.5 shrink-0 text-brand" />{t("«Ulashish» tugmasini bosing", "Tap “Share”")}</li>
        <li className="flex items-center gap-2"><SquarePlus className="h-3.5 w-3.5 shrink-0 text-brand" />{t("«Uy ekraniga qo‘shish»ni tanlang", "Choose “Add to Home Screen”")}</li>
        <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-brand" />{t("Registon belgisidan oching va kiring", "Open it from the Registon icon and sign in")}</li>
      </ol>
      <p className="mt-2 text-[11px] leading-4 text-muted">{t("Shart emas — imtihon shu yerda ham ishlaydi.", "Optional — the exam works here too.")}</p>
    </div>;
  }
  return null;
}
