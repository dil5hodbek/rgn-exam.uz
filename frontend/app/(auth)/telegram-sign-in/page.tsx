"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export default function TelegramSignIn() {
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // Remove the credential from history before contacting the API.
    window.history.replaceState(null, "", window.location.pathname);
    const openPanel = ({ user }: { user: { role: string } }) => {
      window.location.replace(user.role === "STUDENT" ? "/dashboard" : user.role === "TEACHER" ? "/monitor" : "/admin");
    };
    if (!token) {
      // Reloading this callback URL has no fragment, but the saved session remains.
      api<{ role: string }>("/auth/me")
        .then((user) => openPanel({ user }))
        .catch(() => setError("Please request a new sign-in link in Telegram."));
      return;
    }
    // Persist the browser proof before redemption so a lost response can be retried.
    api("/auth/telegram/sign-in/browser", { method: "POST" })
      .then(() => api<{ user: { role: string } }>("/auth/telegram/sign-in/complete", {
        method: "POST", body: JSON.stringify({ token }),
      }))
      .then(openPanel)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Unable to sign in. Request a new link in Telegram.");
      });

  }, []);
  return <section className="mx-auto w-full max-w-md rounded-3xl border border-line bg-canvas p-6 text-center shadow-soft">
    <h1 className="text-2xl font-bold text-ink">Telegram sign-in</h1>
    {error ? <>
      <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>
      <Link href="/sign-in" className="mt-5 inline-flex rounded-xl bg-brand px-5 py-3 font-semibold text-white">Return to Sign In</Link>
    </> : <p role="status" className="mt-4 text-sm text-muted">Signing you in…</p>}
  </section>;
}
