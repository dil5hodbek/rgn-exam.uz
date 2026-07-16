"use client";

import { BarChart3, Bookmark, FilePenLine, LayoutDashboard, LogOut, Settings, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";

const studentNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/solved-tests", label: "Solved Tests", icon: BarChart3 },
  { href: "/teacher-review", label: "Teacher Review", icon: FilePenLine },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [initials, setInitials] = useState("ME");
  const [isAdmin, setIsAdmin] = useState(false);
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
    api<{ first_name: string; last_name: string; role: string }>("/auth/me")
      .then((user) => {
        setInitials(`${user.first_name[0] ?? ""}${user.last_name[0] ?? ""}`.toUpperCase());
        setIsAdmin(["ADMIN", "SUPER_ADMIN"].includes(user.role));
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/sign-in");
      });
  }, [router]);
  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/sign-in");
  }
  const nav = isAdmin
    ? [...studentNav, { href: "/admin", label: "Admin Panel", icon: ShieldCheck }]
    : studentNav;
  return (
    <div className="min-h-screen bg-surface">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-line bg-canvas px-5 py-6 lg:flex lg:flex-col">
        <Logo />
        <nav className="mt-10 space-y-1">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition",
                active ? "bg-indigo-500/10 text-brand" : "text-muted hover:bg-surface hover:text-ink",
              )}>
                <item.icon className="h-5 w-5" />{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-4 text-white">
          <Sparkles className="h-5 w-5" />
          <p className="mt-3 text-sm font-bold">Keep your streak alive</p>
          <p className="mt-1 text-xs leading-5 text-indigo-100">One focused session today moves you forward.</p>
        </div>
        <button onClick={signOut} className="mt-4 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-muted hover:bg-surface hover:text-ink">
          <LogOut className="h-5 w-5" /> Sign Out
        </button>
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/85 px-4 backdrop-blur-xl lg:ml-64 lg:px-8">
        <div className="lg:hidden"><Logo /></div>
        <p className="hidden text-sm font-medium text-muted lg:block">{today}</p>
        <div className="flex items-center gap-2">
          <Link href="/saved-questions" title="Saved questions" className={cn("grid h-10 w-10 place-items-center rounded-xl transition", pathname.startsWith("/saved-questions") ? "bg-indigo-500/10 text-brand" : "text-muted hover:bg-surface")}><Bookmark className="h-4 w-4" /></Link>
          <ThemeToggle />
          <div className="ml-1 h-9 w-9 rounded-full bg-gradient-to-br from-amber-300 to-orange-500 p-0.5">
            <div className="grid h-full w-full place-items-center rounded-full bg-canvas text-xs font-bold text-ink">{initials}</div>
          </div>
        </div>
      </header>
      <main className="pb-24 lg:ml-64 lg:pb-8">{children}</main>
      <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-2xl border border-line bg-canvas/95 p-2 shadow-soft backdrop-blur-xl lg:hidden">
        {nav.map((item) => {
          const active = pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} className={cn("flex min-w-20 flex-col items-center gap-1 rounded-xl px-3 py-2 text-[11px] font-semibold", active ? "bg-indigo-500/10 text-brand" : "text-muted")}><item.icon className="h-5 w-5" />{item.label}</Link>;
        })}
      </nav>
    </div>
  );
}
