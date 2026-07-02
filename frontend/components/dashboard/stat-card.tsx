import { LucideIcon } from "lucide-react";
export function StatCard({ label, value, hint, icon: Icon, tone }: { label: string; value: string; hint: string; icon: LucideIcon; tone: string }) {
  return <div className="rounded-2xl border border-line bg-canvas p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-muted">{label}</p><p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{value}</p></div><span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span></div><p className="mt-4 text-xs font-medium text-muted">{hint}</p></div>;
}
