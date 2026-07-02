import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { LevelCardData } from "@/lib/levels";

const styles: Record<string, string> = {
  coral: "from-orange-400 to-rose-500",
  violet: "from-violet-500 to-indigo-600",
  blue: "from-sky-400 to-blue-600",
  mint: "from-emerald-400 to-teal-600",
};

export function LevelCard({ level }: { level: LevelCardData }) {
  return (
    <Link href={`/dashboard/${level.slug}`} className="group relative overflow-hidden rounded-3xl border border-line bg-canvas p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lift">
      <div className={`absolute right-0 top-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full bg-gradient-to-br opacity-10 blur-2xl ${styles[level.color]}`} />
      <div className="flex items-start justify-between">
        <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${styles[level.color]}`}><level.icon className="h-5 w-5" /></span>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowUpRight className="h-4 w-4" /></span>
      </div>
      <h3 className="mt-6 text-xl font-extrabold text-ink">{level.name}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{level.description}</p>
      <div className="mt-6 flex items-center justify-between text-xs font-bold"><span className="text-muted">{level.completed} of {level.total} completed</span><span className="text-ink">{level.progress}%</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full bg-gradient-to-r ${styles[level.color]}`} style={{ width: `${Math.max(level.progress, 3)}%` }} /></div>
    </Link>
  );
}
