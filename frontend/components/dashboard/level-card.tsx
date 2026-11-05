"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import type { LevelCardData } from "@/lib/levels";
import { LevelIcon, levelGradients as styles } from "./level-icon";


export function LevelCard({ level }: { level: LevelCardData }) {
  const { t } = useLang();
  return (
    <Link href={`/dashboard/${level.slug}`} prefetch={true} className="dashboard-level-card group relative overflow-hidden rounded-3xl border border-line bg-canvas p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lift">
      <div className={`absolute right-0 top-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full bg-gradient-to-br opacity-10 blur-2xl ${styles[level.color]}`} />
      <div className="flex items-start justify-between">
        <LevelIcon level={level} compact />
        <span className="grid h-9 w-9 place-items-center rounded-full bg-surface text-muted transition group-hover:bg-brand group-hover:text-white"><ArrowUpRight className="h-4 w-4" /></span>
      </div>
      <h3 className="mt-6 text-xl font-extrabold text-ink">{level.name}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{level.description}</p>
      <div className="mt-6 flex items-center justify-between text-xs font-bold"><span className="text-muted">{t(`${level.total} tadan ${level.completed} tasi bajarildi`, `${level.completed} of ${level.total} completed`)}</span><span className="text-ink">{level.progress}%</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full bg-gradient-to-r ${styles[level.color]}`} style={{ width: `${Math.max(level.progress, 3)}%` }} /></div>
    </Link>
  );
}
