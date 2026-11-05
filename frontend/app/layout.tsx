import type { Metadata } from "next";
import "./globals.css";
import { CursorGlow } from "@/components/landing/cursor-glow";
import { NavigationProgress } from "@/components/navigation-progress";
import { Providers } from "@/components/providers";
import { getLang } from "@/lib/lang-server";

export const metadata: Metadata = {
  title: "Registon O'quv Markazi",
  description: "Registon o'quv markazi o'quvchilari uchun ingliz tili imtihonlari.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <body><Providers lang={lang}><NavigationProgress />{children}<CursorGlow /></Providers></body>
    </html>
  );
}
