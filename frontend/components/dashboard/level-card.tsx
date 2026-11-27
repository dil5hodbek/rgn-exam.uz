"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import type { LevelCardData } from "@/lib/levels";
import { LevelIcon, levelGradients as styles } from "./level-icon";


export function LevelCard({ level }: { level: LevelCardData }) {
  const { t } = useLang();
  return (
    <Link href={`/dashboard/${level.slug}`} prefetch={true} className="dashboard-level-card group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-canvas p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-lift sm:p-5">
      <div className="flex items-start justify-between">
        <LevelIcon level={level} compact />
        <span className="grid h-8 w-8 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowUpRight className="h-4 w-4" /></span>
      </div>
      <h3 className="mt-4 break-words text-base font-extrabold leading-tight text-ink sm:text-lg">{level.name}</h3>
      <div className="mt-auto pt-4">{level.total > 0 ? <>
        <div className="flex items-center justify-between text-xs font-bold"><span className="text-muted">{t(`${level.completed}/${level.total} test`, `${level.completed}/${level.total} tests`)}</span><span className="text-ink">{level.progress}%</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full bg-gradient-to-r ${styles[level.color]}`} style={{ width: `${Math.max(level.progress, 3)}%` }} /></div>
      </> : <p className="text-xs font-bold text-muted">{t("Tez orada", "Coming soon")}</p>}</div>
    </Link>
  );
}
