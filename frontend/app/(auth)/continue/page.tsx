"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

/** Landing page of "Open in Chrome": trades the single-use hand-off code for
 *  a session in this browser, then goes back to the exam page. */
export default function ContinueInBrowser() {
  const { t } = useLang();
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") ?? "";
    const raw = params.get("next") ?? "/dashboard";
    // Same-site paths only — never an open redirect.
    const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/dashboard";
    // Drop the code from the address bar and history before using it.
    window.history.replaceState(null, "", "/continue");
    const go = () => window.location.replace(next);
    if (!code) {
      api("/auth/me").then(go).catch(() => setError(t("Havola eskirgan. Imtihonni oldingi brauzerdan qayta oching.", "This link has expired. Open the exam again from the other browser.")));
      return;
    }
    api("/auth/handoff/complete", { method: "POST", body: JSON.stringify({ token: code }) })
      .then(go)
      // Already signed in here? Then the code isn't needed.
      .catch(() => api("/auth/me").then(go).catch(() => setError(t("Havola eskirgan. Imtihonni oldingi brauzerdan qayta oching yoki shu yerda kiring.", "This link has expired. Open the exam again from the other browser, or sign in here."))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <section className="mx-auto w-full max-w-md rounded-3xl border border-line bg-canvas p-6 text-center shadow-soft">
    <h1 className="text-2xl font-bold text-ink">{t("Imtihonga o‘tilmoqda", "Opening your exam")}</h1>
    {error ? <>
      <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>
      <Link href="/sign-in" className="mt-5 inline-flex rounded-xl bg-brand px-5 py-3 font-semibold text-white">{t("Kirish", "Sign in")}</Link>
    </> : <p role="status" className="mt-4 text-sm text-muted">{t("Bir lahza…", "One moment…")}</p>}
  </section>;
}
