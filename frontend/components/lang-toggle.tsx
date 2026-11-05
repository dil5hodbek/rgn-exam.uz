"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  const router = useRouter();
  const next = lang === "uz" ? "en" : "uz";
  return (
    <button
      type="button"
      onClick={() => { setLang(next); router.refresh(); }}
      aria-label={lang === "uz" ? "Switch to English" : "O'zbek tiliga o'tish"}
      className={cn("grid h-9 min-w-9 place-items-center rounded-xl px-2 text-xs font-bold text-muted transition hover:bg-surface hover:text-ink", className)}
    >
      {next.toUpperCase()}
    </button>
  );
}
