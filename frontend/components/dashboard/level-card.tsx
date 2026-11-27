"use client";

import { ArrowUpRight, Check, Trophy } from "lucide-react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import type { LevelCardData } from "@/lib/levels";
import { LevelIcon, levelGradients as styles } from "./level-icon";


export function LevelCard({ level }: { level: LevelCardData }) {
  const { t } = useLang();
  const done = level.total > 0 && level.completed >= level.total;
  return (
    <Link href={`/dashboard/${level.slug}`} prefetch={true} className="dashboard-level-card group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-canvas p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-lift sm:p-5">
      <div className="flex items-start justify-between">
        <LevelIcon level={level} compact />
        <span className="grid h-8 w-8 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowUpRight className="h-4 w-4" /></span>
      </div>
      <h3 className="mt-4 break-words text-base font-extrabold leading-tight text-ink sm:text-lg">{level.name}</h3>
      {level.total > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
        {done
          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400"><Check className="h-3 w-3" /> {t("Tugallandi", "Done")}</span>
          : level.completed > 0 || level.started
            ? <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-orange-600 dark:text-orange-400">{t("Jarayonda", "In progress")}</span>
            : <span className="rounded-full bg-surface px-2 py-0.5 text-muted">{t("Boshlanmagan", "Not started")}</span>}
        {level.best != null && <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 tabular-nums text-ink"><Trophy className="h-3 w-3 text-amber-500" /> {Math.round(level.best)}%</span>}
      </div>}
      <div className="mt-auto pt-4">{level.total > 0 ? <>
        <div className="flex items-center justify-between text-xs font-bold"><span className="text-muted">{t(`${level.completed}/${level.total} test`, `${level.completed}/${level.total} tests`)}</span><span className="text-ink">{level.progress}%</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full bg-gradient-to-r ${styles[level.color]}`} style={{ width: `${Math.max(level.progress, 3)}%` }} /></div>
      </> : <p className="text-xs font-bold text-muted">{t("Tez orada", "Coming soon")}</p>}</div>
    </Link>
  );
}
