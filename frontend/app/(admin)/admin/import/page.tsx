"use client";
import { useState } from "react";
import { FileArchive, FileText, Headphones, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  async function upload() {
    if (!file) return;
    setLoading(true); setError("");
    const data = new FormData(); data.append("package", file);
    try {
      const result = await api<{ job_id: string }>("/admin/imports", { method: "POST", body: data });
      router.push(`/admin/import/${result.job_id}/preview`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed."); }
    finally { setLoading(false); }
  }
  return <div className="mx-auto max-w-5xl p-4 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-brand">Content operations</p><h1 className="mt-2 text-3xl font-extrabold text-ink">Bulk Import</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Upload ZIP or RAR packages. Imported content remains under review until approved.</p>
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]"><section className="rounded-3xl border border-line bg-canvas p-6"><label className="grid min-h-72 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line bg-surface p-8 text-center hover:border-indigo-300"><input type="file" accept=".zip,.rar" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"><UploadCloud className="h-7 w-7" /></span><p className="mt-5 font-extrabold text-ink">{file?.name ?? "Choose a ZIP or RAR package"}</p><p className="mt-2 text-sm text-muted">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "Up to 250 MB"}</p></div></label>{error && <p className="mt-4 text-sm font-semibold text-red-600">{error}</p>}<Button className="mt-5 w-full" size="lg" onClick={upload} disabled={!file || loading}>{loading ? "Uploading…" : "Start Import"}</Button></section>
      <aside className="rounded-2xl border border-line bg-canvas p-5"><h2 className="font-extrabold text-ink">Supported resources</h2><div className="mt-4 space-y-4">{[[FileArchive, "Nested archives", "ZIP and RAR"], [FileText, "Word documents", "DOCX and legacy DOC"], [Headphones, "Audio/video", "MP3, MP4, WAV, M4A"]].map(([Icon, title, description]: any) => <div key={title} className="flex gap-3"><Icon className="mt-0.5 h-4 w-4 text-brand" /><div><p className="text-xs font-bold text-ink">{title}</p><p className="mt-0.5 text-[11px] text-muted">{description}</p></div></div>)}</div></aside></div>
  </div>;
}
