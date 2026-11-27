"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Award, Check, Clock3, RotateCcw, Target, Trophy, X } from "lucide-react";
import Link from "next/link";
import { api, API_URL, mediaUrl, refreshSession } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { formatDuration } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize";
import { PromptWithAnswer } from "@/lib/answer-review";

type ReviewMedia = { id: string; file_name: string; url: string; mime_type: string };
type ReviewItem = {
  question_id: string; task_id: string; section: string; task_title?: string;
  passage_html: string | null; media: ReviewMedia | null;
  prompt: string; student_answer: unknown; correct_answer: unknown; is_correct: boolean | null; feedback?: string;
};
type Result = {
  test_variant_id: string;
  title: string; status: string; score: number; max_score: number; percentage: number;
  passing_percentage: number; passed: boolean; retake_allowed: boolean; correct_count: number; incorrect_count: number;
  pending_count: number; time_spent_seconds: number; violations?: number; max_violations?: number;
  sections: { title: string; score: number; max_score: number; percentage: number }[];
  review: ReviewItem[];
};

function formatAnswer(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.map(String).join(" → ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${String(item)}`)
      .join("\n");
  }
  return String(value);
}

export default function ResultPage({ params }: { params: { level: string; examType: string; variant: string; attemptId: string } }) {
  const { lang, t } = useLang();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [retaking, setRetaking] = useState(false);
  const [downloadingCertificate, setDownloadingCertificate] = useState(false);
  const router = useRouter();
  useEffect(() => {
    api<Result>(`/attempts/${params.attemptId}/result`).then(setResult)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t("Natijani yuklab bo'lmadi.", "Unable to load this result.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.attemptId]);
  async function retakeTest() {
    setRetaking(true);
    try {
      await api(`/tests/${params.variant}/attempts`, { method: "POST" });
      router.push(`/dashboard/${params.level}/${params.examType}/${params.variant}/attempt`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Testni qayta boshlab bo'lmadi.", "Unable to retake this test."));
      setRetaking(false);
    }
  }
  async function downloadCertificate() {
    setDownloadingCertificate(true);
    try {
      const certificateUrl = `${API_URL}/attempts/${params.attemptId}/certificate`;
      let response = await fetch(certificateUrl, { credentials: "include" });
      if (response.status === 401 && (await refreshSession())) {
        response = await fetch(certificateUrl, { credentials: "include" });
      }
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.detail || t("Sertifikat yaratib bo'lmadi.", "Unable to generate the certificate."));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `certificate-${params.attemptId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Sertifikat yaratib bo'lmadi.", "Unable to generate the certificate."));
    } finally {
      setDownloadingCertificate(false);
    }
  }
  const reviewGroups = useMemo(() => {
    const groups: { task_id: string; task_title?: string; passage_html: string | null; media: ReviewMedia | null; items: ReviewItem[] }[] = [];
    for (const item of result?.review ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.task_id === item.task_id) last.items.push(item);
      else groups.push({ task_id: item.task_id, task_title: item.task_title, passage_html: item.passage_html, media: item.media, items: [item] });
    }
    return groups;
  }, [result]);
  const questionNumbers = useMemo(() => {
    const map = new Map<string, number>();
    (result?.review ?? []).forEach((item, index) => map.set(item.question_id, index + 1));
    return map;
  }, [result]);
  if (error) return <div className="mx-auto max-w-3xl p-8 text-center text-red-600">{error}</div>;
  if (!result) return <div className="grid min-h-[70vh] place-items-center"><span className="h-10 w-10 animate-spin rounded-full border-4 border-orange-100 border-t-brand" /></div>;
  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    <Link href="/solved-tests" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {t("Natijalarga qaytish", "Back to Solved Tests")}</Link>
    {(result.violations ?? 0) >= (result.max_violations ?? 3) && <p role="status" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      {t(`${result.violations} marta chiqilgani uchun imtihon yakunlandi.`, `Ended after ${result.violations} exits from exam mode.`)}
    </p>}
    <section className="result-hero relative mt-5 overflow-hidden rounded-3xl bg-gradient-to-br from-[#f77926] via-[#ed5b22] to-[#c9430f] p-5 text-white shadow-lg shadow-orange-500/25 sm:p-7"><div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" /><div className="relative flex items-start justify-between gap-4"><div className="min-w-0"><span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold"><Trophy className="h-3.5 w-3.5 text-amber-100" /> {result.status === "PENDING_REVIEW" ? t("O'qituvchi tekshiruvini kutmoqda", "Pending manual review") : t("Test yakunlandi", "Test completed")}</span><h1 className="mt-3 text-xl font-extrabold leading-tight sm:text-3xl">{result.title}</h1><p className="mt-1.5 text-sm text-white/85">{result.passed ? t("Siz o'tish baliga yetdingiz.", "You reached the passing score.") : t("Qayta urinib ko‘ring.", "Try again.")}</p></div><div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-[5px] border-white/30 bg-white/15 sm:h-28 sm:w-28 sm:border-[7px]"><div className="text-center leading-none"><span className="block text-2xl font-extrabold sm:text-4xl">{Math.round(result.percentage)}</span><span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-white/80">{t("foiz", "percent")}</span></div></div></div><div className="relative mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm font-semibold"><span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> {result.correct_count} {t("to'g'ri", "correct")}</span><span className="flex items-center gap-1.5"><X className="h-4 w-4" /> {result.incorrect_count} {t("noto'g'ri", "incorrect")}</span><span className="flex items-center gap-1.5"><Clock3 className="h-4 w-4" /> {formatDuration(result.time_spent_seconds, lang)}</span></div>{((result.passed && result.status === "GRADED") || result.retake_allowed) && <div className="relative mt-4 flex flex-wrap gap-2">{result.passed && result.status === "GRADED" && <button onClick={downloadCertificate} disabled={downloadingCertificate} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-bold text-[#0f2e24] transition hover:bg-emerald-300 disabled:opacity-60"><Award className="h-4 w-4" /> {downloadingCertificate ? t("Tayyorlanmoqda…", "Generating…") : t("Sertifikatni yuklab olish", "Download Certificate")}</button>}{result.retake_allowed && <button onClick={retakeTest} disabled={retaking} className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-bold text-[#c9430f] transition hover:bg-orange-50 disabled:opacity-60"><RotateCcw className="h-4 w-4" /> {retaking ? t("Boshlanmoqda…", "Starting…") : t("Qayta topshirish", "Retake Test")}</button>}</div>}</section>
    <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4"><div className="min-w-0 rounded-2xl border border-line bg-canvas p-3 sm:p-5"><p className="text-xs font-semibold text-muted sm:text-sm">{t("Ball", "Score")}</p><p className="mt-1 text-base font-extrabold text-ink sm:text-2xl">{result.score}<span className="text-xs font-bold text-muted sm:text-base"> / {result.max_score}</span></p></div><div className="min-w-0 rounded-2xl border border-line bg-canvas p-3 sm:p-5"><p className="text-xs font-semibold text-muted sm:text-sm">{t("O'tish bali", "Passing score")}</p><p className="mt-1 text-base font-extrabold text-ink sm:text-2xl">{result.passing_percentage}%</p></div><div className="min-w-0 rounded-2xl border border-line bg-canvas p-3 sm:p-5"><p className="text-xs font-semibold text-muted sm:text-sm">{t("Natija", "Result")}</p><p className={`mt-1 text-base font-extrabold sm:text-2xl ${result.passed ? "text-emerald-600" : "text-rose-600"}`}>{result.passed ? t("O'tdi", "Passed") : t("O'tmadi", "Not passed")}</p></div></div>
    <section className="mt-6 rounded-3xl border border-line bg-canvas p-6"><div className="flex items-center justify-between"><div><h2 className="text-xl font-extrabold text-ink">{t("Bo'limlar bo'yicha", "Section breakdown")}</h2><p className="mt-1 text-sm text-muted">{t("Har bir bo'lim bo'yicha olingan ball.", "Your score in each section.")}</p></div><Target className="h-6 w-6 text-brand" /></div><div className="mt-6 space-y-5">{result.sections.map((section) => <div key={section.title}><div className="flex justify-between text-sm font-bold"><span className="text-ink">{section.title}</span><span className="text-muted">{Math.round(section.percentage)}%</span></div><div className="mt-2 h-2 rounded-full bg-surface"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-300" style={{ width: `${section.percentage}%` }} /></div></div>)}</div></section>
    {reviewGroups.length > 0 && <section className="mt-6 rounded-3xl border border-line bg-canvas p-6">
      <h2 className="text-xl font-extrabold text-ink">{t("Javoblar tahlili", "Answer review")}</h2>
      <div className="mt-5 space-y-6">{reviewGroups.map((group) => <div key={group.task_id}>
        {group.task_title && <p className="text-xs font-bold uppercase tracking-wider text-brand">{group.task_title}</p>}
        {group.media && <div className="mt-2 rounded-2xl bg-surface p-3">
          {group.media.mime_type.startsWith("image/")
            ? <img className="max-h-56 w-full rounded-xl object-contain" src={mediaUrl(group.media.url)} alt={group.media.file_name} />
            : group.media.mime_type.startsWith("video/")
              ? <video controls className="max-h-56 w-full rounded-xl bg-black" src={mediaUrl(group.media.url)} />
              : <audio controls className="h-10 w-full" src={mediaUrl(group.media.url)} />}
        </div>}
        {group.passage_html && <div className="passage-content mt-2 max-h-64 overflow-auto rounded-2xl border border-line bg-surface p-4 text-sm leading-7 text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(group.passage_html) }} />}
        <div className="mt-3 space-y-2.5">{group.items.map((item) => {
          const wrong = item.is_correct === false;
          const right = item.is_correct === true;
          const tone = wrong ? "wrong" : right ? "right" : "neutral";
          const inline = PromptWithAnswer({ prompt: item.prompt, answer: item.student_answer, tone, empty: t("javob yo'q", "no answer") });
          return <div key={item.question_id} className={`review-item flex items-start gap-3 rounded-2xl border p-3.5 sm:p-4 ${wrong ? "review-item-wrong border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10" : right ? "review-item-right border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10" : "border-line"}`}>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-sm font-bold leading-7 text-ink">{questionNumbers.get(item.question_id)}. {inline ?? item.prompt}</p>
              {!inline && <p className={`mt-1.5 flex items-start gap-1.5 whitespace-pre-wrap text-xs font-semibold ${wrong ? "text-rose-600 dark:text-rose-300" : right ? "text-emerald-600 dark:text-emerald-400" : "text-muted"}`}>
                {wrong ? <X className="mt-px h-3.5 w-3.5 shrink-0" /> : right ? <Check className="mt-px h-3.5 w-3.5 shrink-0" /> : null}
                <span>{formatAnswer(item.student_answer, t("Javob yo'q", "No answer"))}</span>
              </p>}
              {wrong && <div className="mt-1.5 flex justify-end">
                <span aria-label={t("To'g'ri javob", "Correct answer")} className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-right text-sm font-extrabold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">{formatAnswer(item.correct_answer, t("O'qituvchi tekshiradi", "Manual review"))}</span>
              </div>}
            </div>
            {item.is_correct === null && <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-muted">{t("Tekshirilmoqda", "In review")}</span>}
          </div>;
        })}</div>
      </div>)}</div>
    </section>}
  </div>;
}
