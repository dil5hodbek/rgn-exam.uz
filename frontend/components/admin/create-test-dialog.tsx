"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

type Level = { id: string; name: string; slug: string };
type ExamType = { id: string; name: string; slug: string };
type ExistingTest = { level_slug: string; exam_type_slug: string; variant_number: number };

const selectClass = "h-12 w-full rounded-xl border border-line bg-canvas px-4 text-sm outline-none focus:border-brand";

export function CreateTestDialog({ existing, onClose }: { existing: ExistingTest[]; onClose: () => void }) {
  const router = useRouter();
  const [levels, setLevels] = useState<Level[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [levelId, setLevelId] = useState("");
  const [examTypeId, setExamTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [variantNumber, setVariantNumber] = useState(1);
  const [timeLimit, setTimeLimit] = useState(60);
  const [passing, setPassing] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Level[]>("/levels"),
      api<ExamType[]>("/levels/beginner/exam-types"),
    ]).then(([levelRows, typeRows]) => {
      setLevels(levelRows);
      setExamTypes(typeRows);
      setLevelId((current) => current || levelRows[0]?.id || "");
      setExamTypeId((current) => current || typeRows[0]?.id || "");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load levels."));
  }, []);

  const level = useMemo(() => levels.find((item) => item.id === levelId), [levels, levelId]);
  const examType = useMemo(() => examTypes.find((item) => item.id === examTypeId), [examTypes, examTypeId]);

  // Suggest the next free variant number for the chosen level + exam type so the
  // unique (level, exam_type, variant_number) constraint is never hit by default.
  const suggestedNumber = useMemo(() => {
    if (!level || !examType) return 1;
    const used = existing
      .filter((row) => row.level_slug === level.slug && row.exam_type_slug === examType.slug)
      .map((row) => row.variant_number);
    return used.length ? Math.max(...used) + 1 : 1;
  }, [existing, level, examType]);

  useEffect(() => { setVariantNumber(suggestedNumber); }, [suggestedNumber]);

  const suggestedTitle = level && examType ? `${level.name} ${examType.name} — Variant ${variantNumber}` : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!levelId || !examTypeId) { setError("Choose a level and exam type."); return; }
    setLoading(true);
    setError("");
    try {
      const created = await api<{ id: string }>("/admin/tests", {
        method: "POST",
        body: JSON.stringify({
          level_id: levelId,
          exam_type_id: examTypeId,
          title: (title.trim() || suggestedTitle).slice(0, 180),
          variant_number: variantNumber,
          time_limit_minutes: timeLimit,
          passing_percentage: passing,
          retake_allowed: true,
          review_allowed: true,
        }),
      });
      router.push(`/admin/tests/${created.id}/edit`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create this test.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-line bg-canvas shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.16em] text-brand">New content</p>
            <h2 className="mt-0.5 text-lg font-extrabold text-ink">Create a test</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-bold text-ink">Level
              <select className={selectClass} value={levelId} onChange={(event) => setLevelId(event.target.value)}>
                {levels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm font-bold text-ink">Exam type
              <select className={selectClass} value={examTypeId} onChange={(event) => setExamTypeId(event.target.value)}>
                {examTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>

          <label className="block space-y-2 text-sm font-bold text-ink">Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={suggestedTitle || "e.g. Beginner Mid-course Test 4"} />
            <span className="text-[11px] font-normal text-muted">Leave blank to use “{suggestedTitle || "auto-generated title"}”.</span>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm font-bold text-ink">Variant #
              <Input type="number" min={1} value={variantNumber} onChange={(event) => setVariantNumber(Math.max(1, Number(event.target.value) || 1))} />
            </label>
            <label className="space-y-2 text-sm font-bold text-ink">Time (min)
              <Input type="number" min={1} max={300} value={timeLimit} onChange={(event) => setTimeLimit(Math.min(300, Math.max(1, Number(event.target.value) || 1)))} />
            </label>
            <label className="space-y-2 text-sm font-bold text-ink">Pass %
              <Input type="number" min={0} max={100} value={passing} onChange={(event) => setPassing(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} />
            </label>
          </div>

          {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading || !levelId || !examTypeId}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create &amp; edit</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
