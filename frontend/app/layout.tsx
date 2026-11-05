import type { Metadata } from "next";
import "./globals.css";
import { CursorGlow } from "@/components/landing/cursor-glow";
import { NavigationProgress } from "@/components/navigation-progress";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Registon O'quv Markazi",
  description: "A focused English examination platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><Providers><NavigationProgress />{children}<CursorGlow /></Providers></body>
    </html>
  );
}
