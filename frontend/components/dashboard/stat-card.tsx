import { LucideIcon } from "lucide-react";

type Accent = "orange" | "emerald" | "amber";

const accents: Record<Accent, { chip: string; glow: string; ghost: string; ring: string; bar: string }> = {
  orange: {
    chip: "bg-orange-500 text-white shadow-orange-500/30",
    glow: "from-orange-500/15",
    ghost: "text-orange-500",
    ring: "#f26522",
    bar: "from-orange-500 to-orange-300",
  },
  emerald: {
    chip: "bg-emerald-500 text-white shadow-emerald-500/30",
    glow: "from-emerald-500/15",
    ghost: "text-emerald-500",
    ring: "#10b981",
    bar: "from-emerald-500 to-emerald-300",
  },
  amber: {
    chip: "bg-amber-500 text-white shadow-amber-500/30",
    glow: "from-amber-500/15",
    ghost: "text-amber-500",
    ring: "#f59e0b",
    bar: "from-amber-500 to-amber-300",
  },
};

/** Stat tile: solid icon chip, big number, a faint oversized icon as the
 * shape in the corner, and — when `progress` is given — a thin meter. */
export function StatCard({ label, value, icon: Icon, accent = "orange", progress }: {
  label: string; value: string; icon: LucideIcon; accent?: Accent; progress?: number;
}) {
  const a = accents[accent];
  return <div className="dashboard-stat-tile relative isolate flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-canvas p-3 shadow-sm sm:rounded-3xl sm:p-5">
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br ${a.glow} via-transparent to-transparent`} />
    <Icon aria-hidden="true" strokeWidth={1.6} className={`pointer-events-none absolute -bottom-5 -right-5 -z-10 h-20 w-20 opacity-[.08] sm:-bottom-7 sm:-right-6 sm:h-32 sm:w-32 ${a.ghost}`} />
    <span className={`grid h-8 w-8 place-items-center rounded-xl shadow-md sm:h-11 sm:w-11 sm:rounded-2xl ${a.chip}`}><Icon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.2} /></span>
    <p className="mt-3 text-xl font-extrabold leading-none tracking-tight text-ink tabular-nums sm:mt-5 sm:text-3xl">{value}</p>
    <p className="mt-1.5 text-[11px] font-semibold leading-snug text-muted sm:text-sm">{label}</p>
    {progress !== undefined && <div className="mt-auto pt-3 sm:pt-4">
      <div className="h-1 overflow-hidden rounded-full bg-surface sm:h-1.5"><div className={`h-full rounded-full bg-gradient-to-r ${a.bar}`} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>
    </div>}
  </div>;
}
