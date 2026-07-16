"use client";
import { Activity, BookOpenCheck, GraduationCap, LayoutDashboard, LogOut, Menu, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";

const items = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/tests", label: "Test Library", icon: BookOpenCheck },
  { href: "/admin/submissions", label: "Teacher Review", icon: GraduationCap },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/audit-log", label: "Audit Log", icon: Activity },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [adminName, setAdminName] = useState("Administrator");
  const [role, setRole] = useState("ADMIN");
  useEffect(() => {
    api<{ first_name: string; last_name: string; role: string }>("/auth/me").then((user) => {
      if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) { router.push("/dashboard"); return; }
      setAdminName(`${user.first_name} ${user.last_name}`); setRole(user.role);
    }).catch((error) => {
      if (error instanceof ApiError && error.status === 401) router.replace("/sign-in");
    });
  }, [router]);
  async function signOut() { await api("/auth/logout", { method: "POST" }).catch(() => undefined); router.push("/sign-in"); }
  return <div className="min-h-screen bg-surface">
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-[#15172a] p-5 text-white lg:flex lg:flex-col"><Logo /><div className="mt-8 rounded-xl bg-white/5 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">Workspace</p><p className="mt-1 text-sm font-bold">Content Operations</p></div><nav className="mt-6 space-y-1">{items.map((item) => { const active = item.exact ? pathname === item.href : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", active ? "bg-indigo-500 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white")}><item.icon className="h-4 w-4" />{item.label}</Link>; })}</nav><div className="mt-auto border-t border-white/10 pt-4"><div className="flex items-center gap-3 px-2"><div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500 text-xs font-extrabold">AD</div><div className="min-w-0"><p className="truncate text-xs font-bold">{adminName}</p><p className="text-[10px] text-slate-500">{role === "SUPER_ADMIN" ? "Super Administrator" : "Administrator"}</p></div></div><button onClick={signOut} className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" /> Sign Out</button></div></aside>
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:ml-64 lg:px-8"><div className="flex items-center gap-3"><button className="lg:hidden"><Menu className="h-5 w-5" /></button><div><p className="text-sm font-extrabold text-ink">Admin Panel</p><p className="hidden text-[11px] text-muted sm:block">Manage content, people, and quality</p></div></div><ThemeToggle /></header>
    <main className="lg:ml-64">{children}</main>
  </div>;
}
