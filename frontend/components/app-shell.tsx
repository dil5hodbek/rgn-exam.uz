"use client";

import { BarChart3, Bookmark, FilePenLine, LayoutDashboard, LogOut, Settings, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./student-responsive.css";
import { Logo } from "./logo";
import { LangToggle } from "./lang-toggle";
import { ThemeToggle } from "./theme-toggle";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api, ApiError, mediaUrl } from "@/lib/api";

const studentNav = [
  { href: "/dashboard", label: ["Bosh sahifa", "Dashboard"], icon: LayoutDashboard },
  { href: "/solved-tests", label: ["Natijalar", "Solved Tests"], icon: BarChart3 },
  { href: "/teacher-review", label: ["Writing baholari", "Writing Feedback"], icon: FilePenLine },
  { href: "/settings", label: ["Sozlamalar", "Settings"], icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { lang, t } = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [initials, setInitials] = useState("ME");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [today, setToday] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString(lang === "uz" ? "uz-UZ" : "en-US", { weekday: "long", month: "long", day: "numeric" }));
    api<{ first_name: string; last_name: string; role: string; avatar_url: string | null }>("/auth/me")
      .then((user) => {
        setInitials(`${user.first_name[0] ?? ""}${user.last_name[0] ?? ""}`.toUpperCase());
        setAvatarUrl(user.avatar_url);
        setIsAdmin(["ADMIN", "SUPER_ADMIN"].includes(user.role));
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/sign-in");
      });
  }, [router, lang]);
  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await api("/auth/logout", { method: "POST" });
      // A fresh document discards authenticated pages from the client router cache.
      window.location.replace("/sign-in");
    } catch (reason) {
      setSignOutError(reason instanceof Error ? reason.message : t("Chiqib bo'lmadi. Qayta urinib ko'ring.", "Unable to sign out. Please try again."));
      setSigningOut(false);
    }
  }
  const nav = (isAdmin
    ? [...studentNav, { href: "/admin", label: ["Admin panel", "Admin Panel"], icon: ShieldCheck }]
    : studentNav).map((item) => ({ ...item, label: t(item.label[0], item.label[1]) }));
  return (
    <div className="min-h-screen bg-surface">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 overflow-y-auto border-r border-line bg-canvas px-5 py-6 lg:flex lg:flex-col">
        <Logo />
        <nav className="mt-10 space-y-1">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition",
                active ? "bg-orange-500/10 text-brand" : "text-muted hover:bg-surface hover:text-ink",
              )}>
                <item.icon className="h-5 w-5" />{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="relative mt-auto overflow-hidden rounded-2xl bg-gradient-to-br from-[#F26522] to-[#D9480F] p-4 text-white">
          <Image src="/brand/registon-mark.png" alt="" width={96} height={96} className="pointer-events-none absolute -bottom-2 -right-1 h-20 w-20 opacity-15 brightness-0 invert" aria-hidden />
          <Sparkles className="relative h-5 w-5" />
          <p className="relative mt-3 text-sm font-bold">{t("Ritmni yo'qotmang", "Keep your streak alive")}</p>
          <p className="relative mt-1 text-xs leading-5 text-orange-50">{t("Bugungi bitta mashg'ulot sizni oldinga siljitadi.", "One focused session today moves you forward.")}</p>
        </div>
        <button onClick={signOut} disabled={signingOut} className="mt-4 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-muted hover:bg-surface hover:text-ink disabled:opacity-60">
          <LogOut className="h-5 w-5" /> {signingOut ? t("Chiqilmoqda…", "Signing out…") : t("Chiqish", "Sign Out")}
        </button>
        {signOutError && <p role="alert" className="px-3 text-sm text-red-600">{signOutError}</p>}
      </aside>
      <header className="student-header sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/85 px-4 backdrop-blur-xl lg:ml-64 lg:px-8">
        <div className="lg:hidden"><Logo /></div>
        <p className="hidden text-sm font-medium text-muted lg:block">{today}</p>
        <div className="flex items-center gap-2">
          <Link href="/saved-questions" title={t("Saqlangan savollar", "Saved questions")} aria-label={t("Saqlangan savollar", "Saved questions")} className={cn("grid h-10 w-10 place-items-center rounded-xl transition", pathname.startsWith("/saved-questions") ? "bg-orange-500/10 text-brand" : "text-muted hover:bg-surface")}><Bookmark className="h-4 w-4" /></Link>
          <LangToggle />
          <ThemeToggle />
          <div className="ml-1 h-9 w-9 rounded-full bg-gradient-to-br from-amber-300 to-orange-500 p-0.5">
            {avatarUrl ? (
              <Image src={mediaUrl(avatarUrl)} alt="" width={36} height={36} className="h-full w-full rounded-full object-cover" unoptimized />
            ) : (
              <div className="grid h-full w-full place-items-center rounded-full bg-canvas text-xs font-bold text-ink">{initials}</div>
            )}
          </div>
        </div>
      </header>
      <main className="student-content min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:ml-64 lg:pb-8">{children}</main>
      <nav className="student-bottom-nav fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex rounded-2xl border border-line bg-canvas/95 p-2 shadow-soft backdrop-blur-xl lg:hidden">
        {nav.map((item) => {
          const active = pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} className={cn("flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[10px] leading-tight sm:px-3 sm:text-[11px] font-semibold", active ? "bg-orange-500/10 text-brand" : "text-muted")}><item.icon className="h-5 w-5" />{item.label}</Link>;
        })}
      </nav>
    </div>
  );
}
