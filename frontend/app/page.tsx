"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

// Landing on "/" used to hard-redirect to /sign-in unconditionally — so an
// already-signed-in visitor (valid cookies and all) saw the login form every
// time they opened the site fresh, instead of picking up their session. This
// checks /auth/me first (which itself retries through the refresh-token flow
// on a 401 — see api() in lib/api.ts) and routes to the right home instead.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api<{ role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN" }>("/auth/me")
      .then((user) => {
        if (user.role === "STUDENT") router.replace("/dashboard");
        else if (user.role === "TEACHER") router.replace("/monitor");
        else router.replace("/admin");
      })
      .catch(() => router.replace("/sign-in"));
  }, [router]);
  return null;
}
