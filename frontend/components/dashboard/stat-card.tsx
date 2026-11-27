import { LucideIcon } from "lucide-react";

type Accent = "orange" | "emerald" | "amber";

const accents: Record<Accent, { card: string; icon: string; from: string; to: string; soft: string }> = {
  orange: {
    card: "border-orange-300/80 bg-orange-50/90 dark:border-orange-400/30 dark:bg-orange-500/10",
    icon: "text-orange-500 dark:text-orange-400",
    from: "#ffc9a3", to: "#f26522", soft: "#ffe3cf",
  },
  emerald: {
    card: "border-emerald-300/80 bg-emerald-50/90 dark:border-emerald-400/30 dark:bg-emerald-500/10",
    icon: "text-emerald-500 dark:text-emerald-400",
    from: "#b7f0d2", to: "#10b981", soft: "#d8f7e7",
  },
  amber: {
    card: "border-amber-300/80 bg-amber-50/90 dark:border-amber-400/30 dark:bg-amber-500/10",
    icon: "text-amber-500 dark:text-amber-400",
    from: "#ffe2a1", to: "#f59e0b", soft: "#fff0c9",
  },
};

/** Pastel stat tile with a glossy ribbon in the corner. */
export function StatCard({ label, value, icon: Icon, accent = "orange" }: { label: string; value: string; icon: LucideIcon; accent?: Accent }) {
  const a = accents[accent];
  const id = `stat-ribbon-${accent}`;
  return <div className={`dashboard-stat-tile relative isolate flex min-w-0 flex-col overflow-hidden rounded-2xl border p-3 shadow-sm sm:rounded-3xl sm:p-5 ${a.card}`}>
    <svg aria-hidden="true" viewBox="0 0 100 100" className="pointer-events-none absolute -right-3 -top-3 -z-10 h-16 w-16 sm:-bottom-4 sm:-right-3 sm:top-auto sm:h-36 sm:w-36 dark:opacity-60">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={a.from} stopOpacity=".9" />
          <stop offset="1" stopColor={a.to} stopOpacity=".7" />
        </linearGradient>
      </defs>
      <circle cx="74" cy="70" r="30" fill={a.soft} className="dark:opacity-15" />
      <path d="M40 104 C 46 70, 72 92, 74 60 S 80 14, 104 10" fill="none" stroke={`url(#${id})`} strokeWidth="16" strokeLinecap="round" />
      <path d="M38 100 C 44 67, 69 89, 71 58 S 78 12, 102 6" fill="none" stroke="#ffffff" strokeOpacity=".65" strokeWidth="3.5" strokeLinecap="round" className="dark:opacity-40" />
    </svg>
    <Icon className={`h-6 w-6 sm:h-8 sm:w-8 ${a.icon}`} strokeWidth={2.2} />
    <p className="mt-3 text-[11px] font-semibold leading-snug text-ink/80 sm:mt-6 sm:text-sm">{label}</p>
    <p className="mt-auto pt-0.5 text-xl leading-none sm:leading-none font-extrabold tracking-tight text-ink sm:text-3xl">{value}</p>
  </div>;
}
