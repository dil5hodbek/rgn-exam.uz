import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 text-ink">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-sm font-extrabold text-white shadow-lg shadow-indigo-500/20">E</span>
      {!compact && <span className="text-lg font-extrabold tracking-tight">ExamFlow</span>}
    </Link>
  );
}
