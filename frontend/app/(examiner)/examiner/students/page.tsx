"use client";
import { useEffect, useMemo, useState } from "react";
import { AtSign, KeyRound, Search, ShieldCheck, Unlock, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { grantLabel, type ExaminerCatalog, type Grant, type StudentRow } from "@/lib/examiner";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PAGE = 30;
type Scope = Grant["scope"];

function StudentDialog({ student, catalog, onClose, onChange }: {
  student: StudentRow; catalog: ExaminerCatalog | null; onClose: () => void; onChange: (row: StudentRow) => void;
}) {
  const { t } = useLang();
  const [username, setUsername] = useState(student.username ?? "");
  const [password, setPassword] = useState("");
  const [scope, setScope] = useState<Scope>("VARIANT");
  const [levelId, setLevelId] = useState(catalog?.levels[0]?.id ?? "");
  const [examTypeId, setExamTypeId] = useState(catalog?.exam_types[0]?.id ?? "");
  const [variantId, setVariantId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const variants = useMemo(() => (catalog?.variants ?? []).filter((variant) =>
    variant.level_id === levelId && variant.exam_type_id === examTypeId), [catalog, levelId, examTypeId]);
  useEffect(() => {
    if (!catalog) return;
    setLevelId((current) => current || catalog.levels[0]?.id || "");
    setExamTypeId((current) => current || catalog.exam_types[0]?.id || "");
  }, [catalog]);

  async function run(work: () => Promise<StudentRow>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const row = await work();
      onChange(row);
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const saveAccount = () => run(() => api<StudentRow>(`/examiner/students/${student.id}`, {
    method: "PATCH",
    body: JSON.stringify({ username: username.trim(), ...(password ? { password } : {}) }),
  }).then((row) => { setPassword(""); setUsername(row.username ?? ""); return row; }), t("Saqlandi.", "Saved."));

  const addGrant = () => run(() => api<StudentRow>(`/examiner/students/${student.id}/grants`, {
    method: "POST",
    body: JSON.stringify({
      scope,
      level_id: scope === "LEVEL" || scope === "EXAM_TYPE" ? levelId : null,
      exam_type_id: scope === "EXAM_TYPE" ? examTypeId : null,
      test_variant_id: scope === "VARIANT" ? variantId : null,
    }),
  }), t("Ruxsat berildi.", "Access granted."));

  const removeGrant = (grant: Grant) => run(
    () => api<StudentRow>(`/examiner/grants/${grant.id}`, { method: "DELETE" }), t("Ruxsat olib tashlandi.", "Access removed."),
  );

  const scopes: [Scope, string][] = [
    ["VARIANT", t("Aniq test", "Specific test")],
    ["EXAM_TYPE", t("Daraja + imtihon turi", "Level + exam type")],
    ["LEVEL", t("Butun daraja", "Whole level")],
    ["ALL", t("Barcha testlar", "All tests")],
  ];
  const canGrant = scope === "ALL" || (scope === "LEVEL" && levelId) || (scope === "EXAM_TYPE" && levelId && examTypeId) || (scope === "VARIANT" && variantId);
  const select = "h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm font-semibold text-ink";

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
    <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-3xl border border-line bg-canvas shadow-lift" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between border-b border-line p-5"><div><h2 className="text-lg font-extrabold text-ink">{student.first_name} {student.last_name}</h2><p className="text-xs text-muted">{student.phone_number}{student.username ? ` · @${student.username}` : ""}</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:text-ink"><X className="h-4 w-4" /></button></div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <section>
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-ink"><AtSign className="h-4 w-4 text-teal-600" /> {t("Kirish ma'lumotlari", "Sign-in details")}</h3>
          <p className="mt-1 text-xs text-muted">{t("O'quvchi telefon raqami yoki shu username bilan kira oladi.", "The student can sign in with their phone number or this username.")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-bold text-muted">Username<Input autoCapitalize="none" placeholder={t("masalan: ism.familiya", "e.g. first.last")} value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="space-y-1.5 text-xs font-bold text-muted">{t("Yangi parol (ixtiyoriy)", "New password (optional)")}<Input type="text" autoComplete="off" placeholder={t("o'zgarmaydi", "unchanged")} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          </div>
          <Button size="sm" className="mt-3 !bg-teal-600 hover:!bg-teal-700" disabled={busy || (password.length > 0 && password.length < 4)} onClick={saveAccount}><KeyRound className="h-4 w-4" /> {t("Saqlash", "Save")}</Button>
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-ink"><Unlock className="h-4 w-4 text-teal-600" /> {t("Imtihonlarga ruxsat", "Exam access")}</h3>
          <p className="mt-1 text-xs text-muted">{t("Ruxsat berilgan testlarga o'quvchi parolsiz kiradi.", "The student opens granted tests without a password.")}</p>
          <div className="mt-3 flex flex-wrap gap-2">{student.grants.length ? student.grants.map((grant) => <span key={grant.id} className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-3 py-1.5 text-xs font-bold text-teal-700 dark:text-teal-300">{grantLabel(grant, t)}<button type="button" aria-label={t("Olib tashlash", "Remove")} disabled={busy} onClick={() => removeGrant(grant)} className="rounded-full p-0.5 hover:bg-teal-500/20"><X className="h-3 w-3" /></button></span>) : <span className="text-xs text-muted">{t("Hech qanday ruxsat yo'q — barcha testlar parol bilan.", "No access yet — every test needs a password.")}</span>}</div>
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap gap-2">{scopes.map(([value, label]) => <button key={value} type="button" onClick={() => setScope(value)} className={cn("rounded-xl border px-3 py-1.5 text-xs font-bold", scope === value ? "border-teal-500 bg-teal-500/10 text-teal-700 dark:text-teal-300" : "border-line bg-canvas text-ink")}>{label}</button>)}</div>
            {scope !== "ALL" && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-bold text-muted">{t("Daraja", "Level")}<select className={select} value={levelId} onChange={(event) => { setLevelId(event.target.value); setVariantId(""); }}>{catalog?.levels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
              {(scope === "EXAM_TYPE" || scope === "VARIANT") && <label className="space-y-1.5 text-xs font-bold text-muted">{t("Imtihon turi", "Exam type")}<select className={select} value={examTypeId} onChange={(event) => { setExamTypeId(event.target.value); setVariantId(""); }}>{catalog?.exam_types.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
              {scope === "VARIANT" && <label className="space-y-1.5 text-xs font-bold text-muted sm:col-span-2">{t("Test", "Test")}<select className={select} value={variantId} onChange={(event) => setVariantId(event.target.value)}><option value="">{variants.length ? t("Testni tanlang", "Choose a test") : t("Nashr qilingan test yo'q", "No published tests")}</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>V{variant.variant_number} — {variant.title}</option>)}</select></label>}
            </div>}
            <Button size="sm" className="mt-3 !bg-teal-600 hover:!bg-teal-700" disabled={busy || !canGrant} onClick={addGrant}><ShieldCheck className="h-4 w-4" /> {t("Ruxsat berish", "Grant access")}</Button>
          </div>
        </section>
        {message && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-600">{message}</p>}
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
      </div>
    </div>
  </div>;
}

export default function ExaminerStudents() {
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<ExaminerCatalog | null>(null);
  const [selected, setSelected] = useState<StudentRow | null>(null);

  useEffect(() => { api<ExaminerCatalog>("/examiner/tests").then(setCatalog).catch(() => undefined); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api<{ total: number; items: StudentRow[] }>(`/examiner/students?limit=${PAGE}&q=${encodeURIComponent(query)}`)
        .then((data) => { if (alive) { setRows(data.items); setTotal(data.total); setError(""); } })
        .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); })
        .finally(() => { if (alive) setLoading(false); });
    }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query]);

  async function loadMore() {
    const data = await api<{ total: number; items: StudentRow[] }>(`/examiner/students?limit=${PAGE}&offset=${rows.length}&q=${encodeURIComponent(query)}`);
    setRows((current) => [...current, ...data.items]);
    setTotal(data.total);
  }
  function replace(row: StudentRow) {
    setRows((current) => current.map((item) => item.id === row.id ? row : item));
    setSelected(row);
  }

  return <div className="mx-auto max-w-6xl p-4 sm:p-8">
    <p className="text-xs font-bold uppercase tracking-[.08em] text-teal-600">{t("O'quvchilar bazasi", "Student base")}</p>
    <h1 className="mt-2 text-3xl font-extrabold text-ink">{t("O'quvchilar", "Students")}</h1>
    <p className="mt-2 max-w-2xl text-sm text-muted">{t("O'quvchini toping, unga username bering va kerakli imtihonlarga ruxsat oching — ruxsat berilgan testlarga u parolsiz kiradi.", "Find a student, give them a username and open the exams they need — they enter granted tests without a password.")}</p>
    <div className="relative mt-6 max-w-xl"><Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted" /><Input className="pl-10" placeholder={t("Ism, familiya, telefon yoki username", "Name, phone or username")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-600">{error}</p>}
    <p className="mt-4 text-xs font-bold text-muted">{loading ? t("Qidirilmoqda…", "Searching…") : t(`${total} ta o'quvchi`, `${total} students`)}</p>
    <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-canvas">
      {rows.length ? rows.map((row, index) => <button key={row.id} type="button" onClick={() => setSelected(row)} className={cn("flex w-full flex-wrap items-center gap-4 p-4 text-left transition hover:bg-surface", index && "border-t border-line")}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-500/10 text-teal-600"><UserRound className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-ink">{row.first_name} {row.last_name} {!row.is_active && <span className="ml-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-600">{t("nofaol", "inactive")}</span>}</p><p className="text-xs text-muted">{row.phone_number}{row.username ? <span className="ml-2 font-bold text-teal-600">@{row.username}</span> : ""}</p></div>
        <div className="flex max-w-full flex-wrap gap-1.5">{row.grants.length ? row.grants.slice(0, 3).map((grant) => <span key={grant.id} className="rounded-full bg-teal-500/10 px-2.5 py-1 text-[11px] font-bold text-teal-700 dark:text-teal-300">{grantLabel(grant, t)}</span>) : <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-muted">{t("Parol bilan", "Password only")}</span>}{row.grants.length > 3 && <span className="text-[11px] font-bold text-muted">+{row.grants.length - 3}</span>}</div>
      </button>) : !loading && <p className="p-10 text-center text-sm text-muted">{t("O'quvchi topilmadi.", "No students found.")}</p>}
    </div>
    {rows.length < total && <div className="mt-4 text-center"><Button variant="secondary" onClick={loadMore}>{t("Yana yuklash", "Load more")}</Button></div>}
    {selected && <StudentDialog student={selected} catalog={catalog} onClose={() => setSelected(null)} onChange={replace} />}
  </div>;
}
