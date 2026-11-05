"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; exact?: boolean };

export function MobileNavigation({ items, pathname, onSignOut }: {
  items: NavItem[];
  pathname: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div ref={root} className="lg:hidden" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open} aria-controls="panel-mobile-navigation" onClick={() => setOpen(!open)}
      className="grid h-11 w-11 place-items-center rounded-xl border border-line text-ink">
      {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
    </button>
    {open && <nav id="panel-mobile-navigation" aria-label="Panel navigation"
      className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-canvas p-4 shadow-xl">
      {items.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
        aria-current={(item.exact ? pathname === item.href : pathname.startsWith(item.href)) ? "page" : undefined}
        className={cn("block rounded-xl px-4 py-3 text-sm font-semibold", (item.exact ? pathname === item.href : pathname.startsWith(item.href)) ? "bg-orange-500/10 text-brand" : "text-ink hover:bg-surface")}>{item.label}</Link>)}
      <button onClick={() => { setOpen(false); onSignOut(); }} className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-left text-sm font-semibold text-ink">Sign Out</button>
    </nav>}
  </div>;
}
