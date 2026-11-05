"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { LANG_COOKIE, type Lang } from "./lang";

export type { Lang } from "./lang";

type LangContextValue = { lang: Lang; setLang: (lang: Lang) => void; t: (uz: string, en: string) => string };

const LangContext = createContext<LangContextValue | null>(null);

// The root layout reads the cookie on the server and passes it in, so the
// first client render matches the server HTML in either language.
export function LangProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);
  const t = useCallback((uz: string, en: string) => (lang === "uz" ? uz : en), [lang]);
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() {
  const value = useContext(LangContext);
  if (!value) throw new Error("useLang must be used inside LangProvider");
  return value;
}
