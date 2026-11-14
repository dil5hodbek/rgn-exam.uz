"use client";
import { ClipboardCheck, LogOut, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LangToggle } from "@/components/lang-toggle";
import { Logo } from "@/components/logo";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ExaminerShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [name, setName] = useState("Examiner");
  const [role, setRole] = useState("EXAMINER");
  useEffect(() => {
    api<{ first_name: string; last_name: string; role: string }>("/auth/me").then((user) => {
      if (!["EXAMINER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) { router.push("/dashboard"); return; }
      setName(`${user.first_name} ${user.last_name}`);
      setRole(user.role);
    }).catch(() => router.replace("/sign-in"));
  }, [router]);
  const items = [
    { href: "/examiner", label: t("Imtihonlar", "Exam sessions"), icon: ClipboardCheck, exact: false },
    { href: "/examiner/students", label: t("O'quvchilar bazasi", "Students"), icon: Users, exact: false },
    ...(role !== "EXAMINER" ? [{ href: "/admin", label: t("Admin panel", "Admin panel"), icon: ShieldCheck, exact: false }] : []),
  ];
  const isActive = (href: string) => href === "/examiner"
    ? pathname === "/examiner" || pathname.startsWith("/examiner/sessions")
    : pathname.startsWith(href);
  async function signOut() { await api("/auth/logout", { method: "POST" }).catch(() => undefined); window.location.replace("/sign-in"); }
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "EX";
  return <div className="min-h-screen bg-surface">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 overflow-y-auto border-r border-line bg-[#13202b] p-5 text-white lg:flex lg:flex-col">
      <Logo darkSurface />
      <div className="mt-8 rounded-xl bg-white/5 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wider text-teal-300">Workspace</p><p className="mt-1 text-sm font-bold">{t("Examiner paneli", "Examiner Panel")}</p></div>
      <nav className="mt-6 space-y-1">{items.map((item) => <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", isActive(item.href) ? "bg-teal-500 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white")}><item.icon className="h-4 w-4" />{item.label}</Link>)}</nav>
      <div className="mt-auto border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 px-2"><div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-500 text-xs font-extrabold">{initials}</div><div className="min-w-0"><p className="truncate text-xs font-bold">{name}</p><p className="text-[10px] text-slate-500">Examiner</p></div></div>
        <button onClick={signOut} className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" /> {t("Chiqish", "Sign Out")}</button>
      </div>
    </aside>
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:ml-64 lg:px-8">
      <div className="flex items-center gap-3"><MobileNavigation items={items.map(({ href, label }) => ({ href, label }))} pathname={pathname} onSignOut={signOut} /><div><p className="text-sm font-extrabold text-ink">{t("Examiner paneli", "Examiner Panel")}</p><p className="hidden text-[11px] text-muted sm:block">{t("Imtihon o'tkazish va o'quvchilarni nazorat qilish", "Run exams and supervise students")}</p></div></div>
      <div className="flex items-center gap-2"><LangToggle /><ThemeToggle /></div>
    </header>
    <main className="min-w-0 lg:ml-64">{children}</main>
  </div>;
}
