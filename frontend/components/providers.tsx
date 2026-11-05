"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { LangProvider, type Lang } from "@/lib/i18n";

export function Providers({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LangProvider initial={lang}><QueryClientProvider client={client}>{children}</QueryClientProvider></LangProvider>
    </ThemeProvider>
  );
}
