"use client";
import { LayoutDashboard, LogOut, Menu, PenLine, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const items = [
  { href: "/monitor", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/monitor/writing", label: "Writing Review", icon: PenLine },
  { href: "/monitor/students", label: "Students", icon: Users },
];

export function MonitorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [teacherName, setTeacherName] = useState("Teacher");
  useEffect(() => {
    api<{ first_name: string; last_name: string; role: string }>("/auth/me").then((user) => {
      if (!["TEACHER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) { router.push("/dashboard"); return; }
      setTeacherName(`${user.first_name} ${user.last_name}`);
    }).catch((error) => {
      // Any failure — expired session, network error, 5xx — means role
      // couldn't be verified, so fail closed instead of leaving the shell
      // rendered with an unverified user.
      void error;
      router.replace("/sign-in");
    });
  }, [router]);
  async function signOut() { await api("/auth/logout", { method: "POST" }).catch(() => undefined); router.push("/sign-in"); }
  const initials = teacherName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "TC";
  return <div className="min-h-screen bg-surface">
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-[#1a1330] p-5 text-white lg:flex lg:flex-col">
      <Logo />
      <div className="mt-8 rounded-xl bg-white/5 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">Workspace</p><p className="mt-1 text-sm font-bold">Monitor Panel</p></div>
      <nav className="mt-6 space-y-1">{items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", active ? "bg-fuchsia-500 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white")}><item.icon className="h-4 w-4" />{item.label}</Link>;
      })}</nav>
      <div className="mt-auto border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 px-2"><div className="grid h-9 w-9 place-items-center rounded-xl bg-fuchsia-500 text-xs font-extrabold">{initials}</div><div className="min-w-0"><p className="truncate text-xs font-bold">{teacherName}</p><p className="text-[10px] text-slate-500">Teacher</p></div></div>
        <button onClick={signOut} className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" /> Sign Out</button>
      </div>
    </aside>
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:ml-64 lg:px-8"><div className="flex items-center gap-3"><button className="lg:hidden"><Menu className="h-5 w-5" /></button><div><p className="text-sm font-extrabold text-ink">Monitor Panel</p><p className="hidden text-[11px] text-muted sm:block">Review writing and track student progress</p></div></div><ThemeToggle /></header>
    <main className="lg:ml-64">{children}</main>
  </div>;
}
