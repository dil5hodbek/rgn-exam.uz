"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Plus, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextField } from "@/components/admin/rich-text-editor";
import { api } from "@/lib/api";

// ── Types coming from GET /admin/question-templates (the single source of
//    truth shared with the backend — the form is built from it) ──
type Template = {
  label: string;
  task_type: string;
  kind: string;
  mode: string;
  per?: string[];
  manual?: boolean;
  ex_words?: boolean;
  ex_prep?: boolean;
  passage?: boolean;
};
type Templates = Record<string, Template>;

// Shape of an existing exercise (from GET /admin/tests) when editing.
type ExistingQuestion = {
  prompt: string; options: unknown[]; correct_answer: unknown; accepted_answers: unknown[];
  points: number; explanation?: string | null; is_example: boolean;
  case_sensitive: boolean; normalize_spaces: boolean; order_index?: number;
};
type ExistingTask = {
  id: string; title: string; type: string; instructions: string; passage_html?: string | null;
  interaction?: { kind?: string; options?: Array<string | { value: string; label: string }>; reuse_options?: boolean; template?: string; min_words?: number; max_words?: number; prep_seconds?: number };
  media?: { id?: string; file_name: string; mime_type?: string; url?: string } | null;
  questions: ExistingQuestion[];
};

type Question = {
  prompt: string;
  options: string[];
  correctSingle: number;
  correctMulti: number[];
  correctBinary: string;
  correctText: string;
  accepted: string;
  caseSensitive: boolean;
  normalizeSpaces: boolean;
  explanation: string;
  points: number;
  isExample: boolean;
  open: boolean;
};

const emptyQ = (): Question => ({
  prompt: "", options: ["", ""], correctSingle: 0, correctMulti: [], correctBinary: "True",
  correctText: "", accepted: "", caseSensitive: false, normalizeSpaces: true,
  explanation: "", points: 1, isExample: false, open: false,
});

const inputClass = "w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand";
const taClass = `${inputClass} min-h-[52px] resize-y`;
const dashBtn = "rounded-lg border border-dashed border-line px-3 py-1 text-xs font-semibold text-brand hover:bg-surface";
const letter = (i: number) => String.fromCharCode(97 + i);

// Finds where the two known alternative phrases sit around the "/" in the
// prompt, the same way exam-runner's inlineAlternative() locates them for
// students — trusting the actual stored option VALUES (which may be multi-word,
// like "have got") rather than re-deriving words from the sentence, which
// can't tell "have" from "have got". Returns the matched span plus which
// option came first, or null if the prompt no longer contains both.
function locateAlternatives(prompt: string, options: string[]) {
  if (options.length !== 2 || !prompt.includes("/")) return null;
  const [a, b] = options.map((o) => o.trim());
  if (!a || !b) return null;
  const slash = prompt.indexOf("/");
  const tryOrder = (first: string, second: string) => {
    const start = prompt.lastIndexOf(first, slash);
    const end = prompt.indexOf(second, slash);
    if (start < 0 || end < 0) return null;
    return { start, end: end + second.length, first, second };
  };
  return tryOrder(a, b) || tryOrder(b, a);
}

// Falls back to parsing "word1 / word2" straight out of the sentence when
// there's no usable stored options yet (a brand-new question). Kept in sync
// with the parsing logic in build().
function matchAlternatives(prompt: string) {
  const phrase = prompt.match(/^(.+?)\s*\/\s*(.+?)(?=\s+\S*\([^)]*\))/);
  const word = prompt.match(/([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)/u);
  return phrase || word;
}

// Randomly reorders a question's options (or its inline "a / b" alternatives)
// so the correct answer isn't predictably always in the same position —
// remaps correctSingle/correctMulti to keep pointing at the same value.
function shuffleQuestionOrder(q: Question, hasCorrectAlt: boolean): Question {
  if (hasCorrectAlt) {
    const located = locateAlternatives(q.prompt, q.options);
    if (located) {
      if (Math.random() < 0.5) return q;
      const { start, end, first, second } = located;
      const swapped = `${second} / ${first}`;
      return {
        ...q,
        prompt: q.prompt.slice(0, start) + swapped + q.prompt.slice(end),
        options: [second, first],
      };
    }
    const m = matchAlternatives(q.prompt);
    if (!m || Math.random() < 0.5) return q;
    const idx = q.prompt.indexOf(m[0]);
    if (idx < 0) return q;
    const opt1 = m[1].trim(), opt2 = m[2].trim();
    const swapped = `${opt2} / ${opt1}`;
    return { ...q, prompt: q.prompt.slice(0, idx) + swapped + q.prompt.slice(idx + m[0].length), options: [opt2, opt1] };
  }
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const options = order.map((i) => q.options[i]);
  const remap = new Map(order.map((originalIndex, newIndex) => [originalIndex, newIndex]));
  return {
    ...q,
    options,
    correctSingle: remap.get(q.correctSingle) ?? q.correctSingle,
    correctMulti: q.correctMulti.map((i) => remap.get(i) ?? i),
  };
}

export function ExerciseBuilder({
  testId, label, exerciseNumber, task, onClose, onSaved,
}: {
  testId: string;
  label?: string;
  exerciseNumber: number;
  task?: ExistingTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(task);
  const [templates, setTemplates] = useState<Templates>({});
  const [type, setType] = useState("multiple_choice");
  const [instructions, setInstructions] = useState("");
  const [media, setMedia] = useState<{ id: string; name: string; kind: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // exercise-level extras
  const [minWords, setMinWords] = useState(150);
  const [maxWords, setMaxWords] = useState(200);
  const [prep, setPrep] = useState(60);
  const [rubric, setRubric] = useState("");
  const [passage, setPassage] = useState("");
  const [showPassage, setShowPassage] = useState(false);

  // composite state
  const [mLeft, setMLeft] = useState(["", ""]);
  const [mRight, setMRight] = useState(["", ""]);
  const [mMap, setMMap] = useState<Record<number, string>>({});
  const [reuse, setReuse] = useState(false);
  const [orderItems, setOrderItems] = useState(["", ""]);
  const [clozeText, setClozeText] = useState("");
  const [clozeGaps, setClozeGaps] = useState([{ n: 1, answer: "", options: "" }]);

  const [questions, setQuestions] = useState<Question[]>([emptyQ()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  // Edit mode must wait until the existing exercise is loaded into the form.
  const [ready, setReady] = useState(!task);
  // Only new exercises autosave a draft (edits already live in the DB).
  const draftKey = editing ? "" : `exercise-draft:${testId}`;
  const skipFirstPersist = useRef(true);

  useEffect(() => {
    api<Templates>("/admin/question-templates")
      .then((loaded) => {
        setTemplates(loaded);
        if (task) { hydrate(loaded); setReady(true); }
      })
      .catch(() => setErrors(["Could not load question types."]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore an unsaved draft when reopening the builder for a new exercise.
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.type) setType(d.type);
      if (d.instructions != null) setInstructions(d.instructions);
      if (d.passage != null) { setPassage(d.passage); if (d.passage) setShowPassage(true); }
      if (d.minWords != null) setMinWords(d.minWords);
      if (d.maxWords != null) setMaxWords(d.maxWords);
      if (d.prep != null) setPrep(d.prep);
      if (d.rubric != null) setRubric(d.rubric);
      if (Array.isArray(d.questions) && d.questions.length) setQuestions(d.questions);
      if (d.mLeft) setMLeft(d.mLeft);
      if (d.mRight) setMRight(d.mRight);
      if (d.mMap) setMMap(d.mMap);
      if (d.reuse != null) setReuse(d.reuse);
      if (d.orderItems) setOrderItems(d.orderItems);
      if (d.clozeText != null) setClozeText(d.clozeText);
      if (d.clozeGaps) setClozeGaps(d.clozeGaps);
      if (d.media) setMedia(d.media);
    } catch { /* ignore malformed draft */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft on every change (skipping the initial mount so we don't
  // clobber a just-restored draft with the default state).
  useEffect(() => {
    if (!draftKey || !ready) return;
    if (skipFirstPersist.current) { skipFirstPersist.current = false; return; }
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        type, instructions, passage, minWords, maxWords, prep, rubric,
        questions, mLeft, mRight, mMap, reuse, orderItems, clozeText, clozeGaps, media,
      }));
    } catch { /* storage full or unavailable */ }
  }, [draftKey, ready, type, instructions, passage, minWords, maxWords, prep, rubric,
      questions, mLeft, mRight, mMap, reuse, orderItems, clozeText, clozeGaps, media]);

  // Fill every field from an existing exercise so the admin edits, not recreates.
  function hydrate(loaded: Templates) {
    if (!task) return;
    const kind = task.interaction?.kind;
    const key = Object.keys(loaded).find((k) => loaded[k].task_type === task.type && loaded[k].kind === kind)
      ?? Object.keys(loaded).find((k) => loaded[k].task_type === task.type)
      ?? "multiple_choice";
    const tplE = loaded[key];
    setType(key);
    setInstructions(task.instructions ?? "");
    if (task.passage_html) { setPassage(task.passage_html); setShowPassage(true); }
    if (task.media?.id) {
      const mk = task.media.mime_type?.startsWith("image/") ? "image" : task.media.mime_type?.startsWith("video/") ? "video" : "audio";
      setMedia({ id: task.media.id, name: task.media.file_name, kind: mk });
    }
    const it = task.interaction ?? {};
    if (it.min_words != null) setMinWords(it.min_words);
    if (it.max_words != null) setMaxWords(it.max_words);
    if (it.prep_seconds != null) setPrep(it.prep_seconds);

    const mode = tplE?.mode ?? "repeat";
    const perE = (f: string) => tplE?.per?.includes(f) ?? false;
    const sorted = [...task.questions].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

    if (mode === "repeat") {
      setQuestions(sorted.length ? sorted.map((q) => {
        const item = emptyQ();
        item.prompt = q.prompt ?? "";
        item.isExample = !!q.is_example;
        item.explanation = q.explanation ?? "";
        item.points = q.points ?? 1;
        item.accepted = (q.accepted_answers ?? []).map(String).join("\n");
        item.caseSensitive = !!q.case_sensitive;
        item.normalizeSpaces = q.normalize_spaces ?? true;
        const opts = (q.options ?? []).map(String);
        if (opts.length) item.options = opts;
        if (perE("correct_multi") && Array.isArray(q.correct_answer)) {
          item.correctMulti = q.correct_answer.map((v) => opts.indexOf(String(v))).filter((i) => i >= 0);
        } else if (perE("options") && !perE("correct_multi")) {
          const idx = opts.indexOf(String(q.correct_answer ?? ""));
          item.correctSingle = idx >= 0 ? idx : 0;
        }
        if (perE("correct_binary") || perE("correct_tfng")) item.correctBinary = String(q.correct_answer ?? "True");
        if (perE("correct_text") || perE("correct_alt")) item.correctText = q.correct_answer == null ? "" : String(q.correct_answer);
        return item;
      }) : [emptyQ()]);
    } else if (mode.startsWith("composite")) {
      const comp = mode.split(":")[1];
      if (comp === "matching") {
        const options = (it.options ?? []) as Array<string | { value: string; label: string }>;
        setMRight(options.length ? options.map((o) => (typeof o === "string" ? o : o.label)) : ["", ""]);
        setMLeft(sorted.length ? sorted.map((q) => q.prompt ?? "") : ["", ""]);
        const map: Record<number, string> = {};
        sorted.forEach((q, i) => { if (q.correct_answer != null) map[i] = String(q.correct_answer); });
        setMMap(map);
        setReuse(!!it.reuse_options);
      } else if (comp === "ordering" || comp === "wordorder") {
        const seq = sorted[0]?.correct_answer;
        setOrderItems(Array.isArray(seq) && seq.length ? seq.map(String) : ["", ""]);
      } else if (comp === "cloze") {
        setClozeText(it.template ?? "");
        setClozeGaps(sorted.length ? sorted.map((q, i) => ({
          n: q.order_index ?? i + 1,
          answer: q.correct_answer == null ? "" : String(q.correct_answer),
          options: (q.options ?? []).map(String).join(" / "),
        })) : [{ n: 1, answer: "", options: "" }]);
      }
    }
  }

  const tpl = templates[type];
  const per = (f: string) => tpl?.per?.includes(f) ?? false;
  const isRepeat = tpl?.mode === "repeat";
  const comp = tpl?.mode?.startsWith("composite") ? tpl.mode.split(":")[1] : null;

  const setQ = (i: number, patch: Partial<Question>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  // Only meaningful when there's an actual position to scramble: a fixed
  // option list, or two inline alternatives embedded in the prompt.
  const canRandomize = per("options") || per("correct_alt");
  const randomizeOrder = () =>
    setQuestions((qs) => qs.map((q) => (q.isExample ? q : shuffleQuestionOrder(q, per("correct_alt")))));

  // Reads whatever is currently on screen — the repeat questions list, or one
  // of the composite editors (matching/ordering/cloze) — into a shared shape,
  // using the CURRENT template's per-fields to know how "correct" is encoded.
  function extractItems(): { prompt: string; correct: string; options: string[]; isExample: boolean }[] {
    if (isRepeat) {
      return questions.map((q) => {
        let correct = "";
        if (per("correct_multi")) correct = q.correctMulti.map((i) => q.options[i]).filter(Boolean).join(", ");
        else if (per("correct_single")) correct = q.options[q.correctSingle] ?? "";
        else if (per("correct_binary") || per("correct_tfng")) correct = q.correctBinary;
        else if (per("correct_text") || per("correct_alt")) correct = q.correctText;
        return { prompt: q.prompt, correct, options: q.options.filter(Boolean), isExample: q.isExample };
      });
    }
    if (comp === "matching") {
      return mLeft.map((p, i) => {
        const idx = mMap[i] ? mRight.findIndex((_, j) => letter(j) === mMap[i]) : -1;
        return { prompt: p, correct: idx >= 0 ? mRight[idx] : "", options: mRight.filter(Boolean), isExample: false };
      });
    }
    if (comp === "ordering" || comp === "wordorder") {
      const items = orderItems.filter(Boolean);
      if (!items.length) return [];
      return [{
        prompt: comp === "wordorder" ? items.join(" ") : "Arrange in the correct order",
        correct: items.join(", "), options: items, isExample: false,
      }];
    }
    if (comp === "cloze") {
      return clozeGaps.map((g) => ({
        prompt: `Gap ${g.n}`, correct: g.answer,
        options: g.options.split("/").map((s) => s.trim()).filter(Boolean), isExample: false,
      }));
    }
    return [];
  }

  // Rebuilds whichever state the NEW type needs from the extracted items, so
  // switching "Question type" carries prompts/answers over instead of
  // silently swapping in an empty editor.
  function applyItems(items: { prompt: string; correct: string; options: string[]; isExample: boolean }[], newTpl: Template) {
    const withContent = items.filter((i) => i.prompt.trim() || i.correct.trim() || i.options.length);
    if (newTpl.mode === "repeat") {
      if (!withContent.length) { setQuestions([emptyQ()]); return; }
      setQuestions(withContent.map((item) => {
        const q = emptyQ();
        q.prompt = item.prompt;
        q.isExample = item.isExample;
        if (newTpl.per?.includes("options") || newTpl.per?.includes("correct_alt")) {
          const opts = item.options.length ? item.options : [item.correct, ""].filter((v, i, a) => v || i === 0);
          q.options = opts.length >= 2 ? opts : [...opts, ...Array(2 - opts.length).fill("")];
          const idx = q.options.findIndex((o) => o === item.correct);
          if (newTpl.per.includes("correct_multi")) q.correctMulti = idx >= 0 ? [idx] : [];
          else q.correctSingle = idx >= 0 ? idx : 0;
        }
        if (newTpl.per?.includes("correct_binary") || newTpl.per?.includes("correct_tfng"))
          q.correctBinary = ["True", "False", "Not Given"].includes(item.correct) ? item.correct : "True";
        if (newTpl.per?.includes("correct_text") || newTpl.per?.includes("correct_alt")) q.correctText = item.correct;
        return q;
      }));
      return;
    }
    const comp2 = newTpl.mode?.startsWith("composite") ? newTpl.mode.split(":")[1] : null;
    if (comp2 === "matching") {
      const rightVals = Array.from(new Set(withContent.map((i) => i.correct).filter(Boolean)));
      setMLeft(withContent.length ? withContent.map((i) => i.prompt) : ["", ""]);
      setMRight(rightVals.length >= 2 ? rightVals : [...rightVals, "", ""].slice(0, Math.max(2, rightVals.length)));
      const map: Record<number, string> = {};
      withContent.forEach((item, i) => {
        const idx = rightVals.indexOf(item.correct);
        if (idx >= 0) map[i] = letter(idx);
      });
      setMMap(map);
    } else if (comp2 === "ordering" || comp2 === "wordorder") {
      const flat = withContent.flatMap((i) => (i.options.length ? i.options : i.prompt ? [i.prompt] : []));
      setOrderItems(flat.length >= 2 ? flat : ["", ""]);
    } else if (comp2 === "cloze") {
      setClozeGaps(withContent.length
        ? withContent.map((item, i) => ({ n: i + 1, answer: item.correct, options: item.options.join(" / ") }))
        : [{ n: 1, answer: "", options: "" }]);
      if (!clozeText.trim() && withContent.length)
        setClozeText(withContent.map((item, i) => `${item.prompt} {{${i + 1}}}`).join(" "));
    }
  }

  function changeType(newKey: string) {
    const newTpl = templates[newKey];
    if (newTpl && newKey !== type) applyItems(extractItems(), newTpl);
    setType(newKey);
    setErrors([]);
  }

  async function onFile(file: File, kind: string) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploaded = await api<{ id: string; file_name: string }>("/admin/media", { method: "POST", body: form });
      setMedia({ id: uploaded.id, name: uploaded.file_name, kind });
    } catch {
      setErrors(["Could not upload the media file."]);
    } finally {
      setUploading(false);
    }
  }

  // Import question text from a .docx: the backend returns a best-effort draft
  // (type + prompts/options) which we load into the form for review.
  async function importDocx(file: File) {
    setImporting(true); setErrors([]); setImportNote("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<{ template_key: string; instructions: string; questions: { prompt: string; options: string[] }[]; left?: string[]; right?: string[] }>(
        "/admin/parse-docx", { method: "POST", body: form },
      );
      if (r.template_key && templates[r.template_key]) setType(r.template_key);
      if (r.instructions) setInstructions(r.instructions);
      // Matching: fill the two columns; the admin sets the correct pairs.
      if (r.template_key === "matching_pairs" && (r.left?.length || r.right?.length)) {
        setMLeft(r.left?.length ? r.left : ["", ""]);
        setMRight(r.right?.length ? r.right : ["", ""]);
        setMMap({});
        setImportNote(`Imported ${r.left?.length ?? 0} prompts and ${r.right?.length ?? 0} options. Set the correct matches.`);
      } else if (r.questions.length) {
        setQuestions(r.questions.map((q) => {
          const item = emptyQ();
          item.prompt = q.prompt;
          const opts = (q.options ?? []).filter(Boolean);
          if (opts.length) item.options = opts.length >= 2 ? opts : [...opts, ""];
          return item;
        }));
        setImportNote(`Imported ${r.questions.length} question(s). Review the type, mark answers, and add media.`);
      }
    } catch (reason) {
      const msg = reason instanceof Error ? reason.message : "";
      setErrors([msg && msg !== "[object Object]" ? msg : "Could not import this document."]);
    } finally {
      setImporting(false);
    }
  }

  function build() {
    if (!tpl) return null;
    const errs: string[] = [];
    if (!instructions.trim()) errs.push("Instructions are empty.");

    const interaction: Record<string, unknown> = { kind: tpl.kind };
    if (tpl.ex_words) { interaction.min_words = +minWords; interaction.max_words = +maxWords; interaction.manual_review = true; }
    if (tpl.ex_prep) { interaction.prep_seconds = +prep; interaction.manual_review = true; }

    const payloadTask: Record<string, unknown> = {
      title: task?.title || `Exercise ${exerciseNumber}`,
      type: tpl.task_type,
      template_key: type,
      instructions: instructions.trim(),
      interaction,
      passage_html: null as string | null,
      media_asset_id: media?.id ?? null,
      audio_replay_limit: null,
      questions: [] as unknown[],
    };
    if ((tpl.ex_words || tpl.ex_prep) && rubric.trim()) payloadTask.rubric = rubric.trim();
    if (tpl.passage) { if (!passage.trim()) errs.push("Reading passage is empty."); payloadTask.passage_html = passage.trim(); }
    else if (passage.trim()) payloadTask.passage_html = passage.trim();

    const out: Record<string, unknown>[] = [];
    if (isRepeat) {
      questions.forEach((q, i) => {
        const num = i + 1;
        const it: Record<string, unknown> = { order_index: num, is_example: q.isExample, points: +q.points };
        if (per("prompt") || per("prompt_gap") || per("prompt_alt")) {
          if (!q.prompt.trim() && !q.isExample) errs.push(`Question ${num}: prompt is empty.`);
          it.prompt = q.prompt.trim();
        }
        if (per("options")) {
          const o = q.options.map((x) => x.trim()).filter(Boolean);
          if (o.length < 2 && !q.isExample) errs.push(`Question ${num}: at least 2 options are required.`);
          it.options = o;
        }
        if (per("correct_single")) it.correct_answer = q.options[q.correctSingle]?.trim();
        if (per("correct_multi")) {
          const ca = q.correctMulti.map((k) => q.options[k]?.trim()).filter(Boolean);
          if (!ca.length && !q.isExample) errs.push(`Question ${num}: mark the correct answer.`);
          it.correct_answer = ca;
        }
        if (per("correct_binary") || per("correct_tfng")) it.correct_answer = q.correctBinary;
        if (per("correct_text")) {
          if (!q.correctText.trim() && !q.isExample) errs.push(`Question ${num}: correct answer is missing.`);
          it.correct_answer = q.correctText.trim();
        }
        if (per("correct_alt")) {
          // Prefer the already-known option values (from a prior save, or a
          // shuffle) over re-parsing the sentence: a plain word/word regex
          // can't tell "have" from "have got", so re-deriving on every save
          // would silently truncate multi-word alternatives that lack a
          // trailing verb-form marker like "is(are)". Only fall back to
          // parsing when there's nothing usable yet (a brand-new question).
          const located = locateAlternatives(q.prompt, q.options);
          const phrase = !located ? q.prompt.match(/^(.+?)\s*\/\s*(.+?)(?=\s+\S*\([^)]*\))/) : null;
          const word = !located ? q.prompt.match(/([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)/u) : null;
          const m = phrase || word;
          const opt1 = located ? located.first : m?.[1]?.trim();
          const opt2 = (located ? located.second : m?.[2]?.trim()) ?? "";
          if (!opt1 && !q.isExample) errs.push(`Question ${num}: write "word1 / word2" (or "phrase one / phrase two" followed by a verb form like "is(are)").`);
          else if (opt1) {
            it.options = [opt1, opt2];
            const chosen = q.correctText.trim();
            if (!chosen && !q.isExample) errs.push(`Question ${num}: mark which alternative is correct (it defaulted silently before — now it's required).`);
            else if (chosen && ![opt1, opt2].some((o) => o.toLowerCase() === chosen.toLowerCase()) && !q.isExample)
              errs.push(`Question ${num}: correct answer "${chosen}" doesn't match either "${opt1}" or "${opt2}".`);
            it.correct_answer = chosen || opt1;
          }
        }
        if (per("accepted") && q.accepted.trim())
          it.accepted_answers = q.accepted.split("\n").map((s) => s.trim()).filter(Boolean);
        if (per("textcfg")) { it.case_sensitive = q.caseSensitive; it.normalize_spaces = q.normalizeSpaces; }
        if (q.explanation.trim()) it.explanation = q.explanation.trim();
        if (tpl.manual) it.correct_answer = null;
        out.push(it);
      });
    } else if (comp === "matching") {
      const L = mLeft.map((x) => x.trim()).filter(Boolean);
      const R = mRight.map((x) => x.trim()).filter(Boolean);
      if (L.length < 2 || R.length < 2) errs.push("Each column needs at least 2 items.");
      interaction.options = R.map((label, i) => ({ value: letter(i), label }));
      interaction.reuse_options = reuse;
      L.forEach((p, i) => {
        if (mMap[i] == null) errs.push(`Prompt ${i + 1}: no match selected.`);
        out.push({ order_index: i + 1, prompt: p, correct_answer: mMap[i] ?? null });
      });
    } else if (comp === "ordering" || comp === "wordorder") {
      const items = orderItems.map((x) => x.trim()).filter(Boolean);
      if (items.length < 2) errs.push("At least 2 items are required.");
      out.push({
        order_index: 1,
        prompt: comp === "wordorder" ? items.join(" / ") : "Arrange in the correct order",
        correct_answer: items,
      });
    } else if (comp === "cloze") {
      if (!clozeText.trim()) errs.push("The passage template is empty.");
      interaction.template = clozeText.trim();
      clozeGaps.forEach((g, i) => {
        if (!g.answer.trim()) errs.push(`{{${g.n}}}: answer is missing.`);
        const o = g.options.split("/").map((s) => s.trim()).filter(Boolean);
        out.push({ order_index: i + 1, prompt: `Gap ${g.n}`, correct_answer: g.answer.trim(), options: o.length ? o : [] });
      });
    }

    payloadTask.questions = out;
    return { payloadTask, errs };
  }

  async function save() {
    const result = build();
    if (!result) return;
    if (result.errs.length) { setErrors(result.errs); return; }
    setSaving(true);
    setErrors([]);
    try {
      if (editing && task) {
        await api(`/admin/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify(result.payloadTask) });
      } else {
        await api(`/admin/tests/${testId}/tasks`, { method: "POST", body: JSON.stringify(result.payloadTask) });
      }
      if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }
      onSaved();
    } catch (reason) {
      const msg = reason instanceof Error ? reason.message : "";
      setErrors([msg && msg !== "[object Object]" ? msg : "Could not save the exercise. Please check the fields."]);
      setSaving(false);
    }
  }

  const mediaButtons: [string, string][] = [["audio", "🎵 Audio"], ["image", "🖼 Image"], ["video", "🎬 Video"]];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 my-6 w-full max-w-3xl rounded-3xl border border-line bg-surface shadow-2xl">
        {/* ── header ── */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-extrabold text-brand">{editing ? (task?.title || "Exercise") : `Exercise ${exerciseNumber}`}</span>
            <span className="text-sm text-muted">{label ? `· ${label}` : ""}{editing ? " · edit" : ""}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><X className="h-4 w-4" /></button>
        </div>

        {!ready ? <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted" /></div> : <>
        <div className="space-y-4 p-6">
          {/* ── DOCX import ── */}
          <div>
            <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand bg-brand/5 px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/10 ${importing ? "opacity-60" : ""}`}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Import questions from Word (.docx)
              <input type="file" accept=".docx" className="hidden" disabled={importing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importDocx(f); e.target.value = ""; }} />
            </label>
            <p className="mt-1 text-[11px] text-muted">Pulls question text and detects the type. You still mark the correct answers and add media.</p>
            {importNote && <p className="mt-1 text-[11px] font-semibold text-emerald-600">✓ {importNote}</p>}
          </div>

          {/* ── exercise-level ── */}
          <div className="rounded-2xl border border-line bg-canvas p-4">
            <label className="block text-xs font-bold text-muted">Question type
              <select value={type} onChange={(e) => changeType(e.target.value)} className={`${inputClass} mt-1 cursor-pointer`}>
                {Object.entries(templates).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </label>

            <label className="mt-3 block text-xs font-bold text-muted">Instructions
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} className={`${taClass} mt-1`}
                placeholder="Listen to five short conversations and choose the correct answers, a, b or c." />
            </label>

            {tpl?.ex_words && <div className="mt-3 flex gap-3">
              <label className="text-xs font-bold text-muted">Min words<input type="number" value={minWords} onChange={(e) => setMinWords(+e.target.value)} className={`${inputClass} mt-1 w-24`} /></label>
              <label className="text-xs font-bold text-muted">Max words<input type="number" value={maxWords} onChange={(e) => setMaxWords(+e.target.value)} className={`${inputClass} mt-1 w-24`} /></label>
            </div>}
            {tpl?.ex_prep && <label className="mt-3 block text-xs font-bold text-muted">Preparation time (seconds)<input type="number" value={prep} onChange={(e) => setPrep(+e.target.value)} className={`${inputClass} mt-1 w-28`} /></label>}
            {(tpl?.ex_words || tpl?.ex_prep) && <label className="mt-3 block text-xs font-bold text-muted">Grading rubric (optional)<textarea value={rubric} onChange={(e) => setRubric(e.target.value)} className={`${taClass} mt-1`} /></label>}

            {tpl?.passage
              ? <div className="mt-3"><RichTextField label="Reading passage (with paragraphs A, B, C)" value={passage} onChange={setPassage} /></div>
              : (showPassage || passage.trim()
                ? <div className="mt-3"><RichTextField label="Reading passage (students read it first)" value={passage} onChange={setPassage} onRemove={() => { setPassage(""); setShowPassage(false); }} /></div>
                : <button onClick={() => setShowPassage(true)} className={`${dashBtn} mt-3 block`}>+ Add reading passage (optional)</button>)}

            {/* media */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-muted">Media:</span>
              {mediaButtons.map(([k, l]) => (
                <label key={k} className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:border-brand">
                  {l}
                  <input type="file" accept={`${k}/*`} className="hidden" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f, k); e.target.value = ""; }} />
                </label>
              ))}
              {uploading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
              {media && <span className="text-xs font-semibold text-emerald-600">✓ {media.name} <button onClick={() => setMedia(null)} className="text-muted">×</button></span>}
            </div>
          </div>

          {/* ── REPEAT questions ── */}
          {isRepeat && <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Questions {tpl?.manual ? "· teacher-graded" : ""}</p>
              {canRandomize && <button onClick={randomizeOrder} className={dashBtn} title="Shuffle which position the correct answer lands in for every question">
                <Shuffle className="mr-1 inline h-3 w-3" /> Randomize order
              </button>}
            </div>
            {questions.map((q, i) => (
              <div key={i} className={`flex gap-3 rounded-xl border bg-canvas p-3 ${q.isExample ? "border-amber-400" : "border-line"}`}>
                <div className={`min-w-[22px] pt-1.5 font-mono text-sm font-bold ${q.isExample ? "text-amber-500" : "text-brand"}`}>{q.isExample ? "e.g" : i + 1}</div>
                <div className="flex-1 space-y-2">
                  {(per("prompt") || per("prompt_gap") || per("prompt_alt")) &&
                    <input value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} className={inputClass}
                      placeholder={per("prompt_gap") ? "They ___ to 10 countries. (travel)" : per("prompt_alt") ? "Do you deal with / at this?  —or—  Two brothers / a sister is(are) smart." : "Question text"} />}

                  {per("options") && <div className="space-y-1.5">
                    {q.options.map((o, oi) => {
                      const multi = per("correct_multi");
                      const on = multi ? q.correctMulti.includes(oi) : q.correctSingle === oi;
                      return <div key={oi} className="flex items-center gap-2">
                        <button title="Correct answer" onClick={() => multi
                          ? setQ(i, { correctMulti: on ? q.correctMulti.filter((x) => x !== oi) : [...q.correctMulti, oi] })
                          : setQ(i, { correctSingle: oi })}
                          className={`grid h-5 w-5 flex-none place-items-center border text-[10px] text-emerald-600 ${multi ? "rounded" : "rounded-full"} ${on ? "border-emerald-500 bg-emerald-500/15" : "border-line"}`}>{on ? "✓" : ""}</button>
                        <span className="w-3 font-mono text-xs text-muted">{letter(oi)}</span>
                        <input value={o} placeholder={`Option ${letter(oi)}`} onChange={(e) => { const n = [...q.options]; n[oi] = e.target.value; setQ(i, { options: n }); }} className={`${inputClass} py-1.5`} />
                        <button onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== oi) })} className="text-muted hover:text-ink">×</button>
                      </div>;
                    })}
                    <button onClick={() => setQ(i, { options: [...q.options, ""] })} className={dashBtn}>+ option</button>
                  </div>}

                  {(per("correct_binary") || per("correct_tfng")) && <div className="flex gap-1.5">
                    {(per("correct_tfng") ? ["True", "False", "Not Given"] : ["True", "False"]).map((v) => (
                      <button key={v} onClick={() => setQ(i, { correctBinary: v })}
                        className={`rounded-lg border px-3.5 py-1.5 text-sm ${q.correctBinary === v ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "border-line text-ink"}`}>{v}</button>))}
                  </div>}

                  {per("correct_text") && <input value={q.correctText} onChange={(e) => setQ(i, { correctText: e.target.value })} className={`${inputClass} max-w-[340px]`} placeholder={type === "error_correction" ? "corrected word" : "correct answer"} />}
                  {per("correct_alt") && <input value={q.correctText} onChange={(e) => setQ(i, { correctText: e.target.value })} className={`${inputClass} max-w-[340px]`} placeholder="correct word or phrase (e.g. with, or Two brothers)" />}
                  {tpl?.manual && <p className="text-xs text-amber-500">No answer needed — graded by the teacher.</p>}

                  {!tpl?.manual && <button onClick={() => setQ(i, { open: !q.open })} className="text-xs text-muted hover:text-ink">
                    {q.open ? "▾" : "▸"} more (accepted answers, case, explanation, points, example)</button>}
                  {q.open && !tpl?.manual && <div className="space-y-2 rounded-lg bg-surface p-3">
                    {per("accepted") && <label className="block text-xs font-bold text-muted">Accepted alternative answers (one per line)<textarea value={q.accepted} onChange={(e) => setQ(i, { accepted: e.target.value })} className={`${taClass} mt-1 min-h-[40px]`} placeholder="have traveled" /></label>}
                    {per("textcfg") && <div className="flex gap-4 text-xs text-muted">
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.caseSensitive} onChange={(e) => setQ(i, { caseSensitive: e.target.checked })} /> Case sensitive</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.normalizeSpaces} onChange={(e) => setQ(i, { normalizeSpaces: e.target.checked })} /> Normalize spaces</label>
                    </div>}
                    <label className="block text-xs font-bold text-muted">Explanation (optional)<input value={q.explanation} onChange={(e) => setQ(i, { explanation: e.target.value })} className={`${inputClass} mt-1`} placeholder="Why this answer is correct" /></label>
                    <div className="flex items-center gap-4">
                      <label className="text-xs font-bold text-muted">Points<input type="number" value={q.points} onChange={(e) => setQ(i, { points: +e.target.value })} className={`${inputClass} mt-1 w-20`} /></label>
                      {i === 0 && <label className="mt-4 flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={q.isExample} onChange={(e) => setQ(i, { isExample: e.target.checked })} /> Example — not scored</label>}
                    </div>
                  </div>}
                </div>
                {questions.length > 1 && <button onClick={() => setQuestions(questions.filter((_, j) => j !== i))} className="self-start text-lg text-muted hover:text-ink">×</button>}
              </div>
            ))}
            <button onClick={() => setQuestions([...questions, emptyQ()])} className="w-full rounded-xl border border-dashed border-line py-2.5 text-sm font-semibold text-brand hover:bg-canvas"><Plus className="mr-1 inline h-4 w-4" /> Add question</button>
          </div>}

          {/* ── COMPOSITE: matching ── */}
          {comp === "matching" && <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="mb-2 text-xs font-bold text-muted">Left column (prompts) → correct option</p>
              {mLeft.map((v, i) => <div key={i} className="mb-1.5 flex items-center gap-1.5">
                <span className="w-4 font-mono text-xs text-muted">{i + 1}</span>
                <input value={v} placeholder={`Prompt ${i + 1}`} onChange={(e) => { const n = [...mLeft]; n[i] = e.target.value; setMLeft(n); }} className={`${inputClass} py-1.5`} />
                <select value={mMap[i] ?? ""} onChange={(e) => setMMap({ ...mMap, [i]: e.target.value })} className={`${inputClass} w-14 cursor-pointer px-1 py-1.5`}>
                  <option value="">→</option>
                  {mRight.map((_, j) => <option key={j} value={letter(j)}>{letter(j)}</option>)}
                </select>
                <button onClick={() => setMLeft(mLeft.filter((_, j) => j !== i))} className="text-muted hover:text-ink">×</button>
              </div>)}
              <button onClick={() => setMLeft([...mLeft, ""])} className={dashBtn}>+ prompt</button>
            </div>
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="mb-2 text-xs font-bold text-muted">Right column (options a, b, c…)</p>
              {mRight.map((v, i) => <div key={i} className="mb-1.5 flex items-center gap-1.5">
                <span className="w-4 font-mono text-xs text-muted">{letter(i)}</span>
                <input value={v} placeholder={`Option ${letter(i)}`} onChange={(e) => { const n = [...mRight]; n[i] = e.target.value; setMRight(n); }} className={`${inputClass} py-1.5`} />
                <button onClick={() => setMRight(mRight.filter((_, j) => j !== i))} className="text-muted hover:text-ink">×</button>
              </div>)}
              <button onClick={() => setMRight([...mRight, ""])} className={dashBtn}>+ option</button>
              <label className="mt-2.5 flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} /> Options can be reused</label>
            </div>
          </div>}

          {/* ── COMPOSITE: ordering ── */}
          {(comp === "ordering" || comp === "wordorder") && <div className="rounded-xl border border-line bg-canvas p-4">
            <p className="mb-2 text-xs font-bold text-muted">{comp === "wordorder" ? "Words — in the CORRECT order (shuffled for students)" : "Items — in the CORRECT order"}</p>
            {orderItems.map((v, i) => <div key={i} className="mb-1.5 flex items-center gap-1.5">
              <span className="w-5 font-mono text-xs text-muted">{i + 1}</span>
              <input value={v} placeholder={comp === "wordorder" ? "word" : "item"} onChange={(e) => { const n = [...orderItems]; n[i] = e.target.value; setOrderItems(n); }} className={`${inputClass} py-1.5`} />
              <button onClick={() => setOrderItems(orderItems.filter((_, j) => j !== i))} className="text-muted hover:text-ink">×</button>
            </div>)}
            <button onClick={() => setOrderItems([...orderItems, ""])} className={dashBtn}>+ {comp === "wordorder" ? "word" : "item"}</button>
          </div>}

          {/* ── COMPOSITE: cloze ── */}
          {comp === "cloze" && <div className="rounded-xl border border-line bg-canvas p-4">
            <p className="mb-1.5 text-xs font-bold text-muted">Passage template — mark blanks with {"{{1}}"}, {"{{2}}"}</p>
            <textarea value={clozeText} onChange={(e) => setClozeText(e.target.value)} className={`${taClass} mb-2.5 min-h-[70px]`} placeholder="Climate change is a global {{1}} caused mainly by {{2}}, leading to rising temperatures." />
            <p className="mb-1.5 text-xs font-bold text-muted">Answer for each blank (separate options with / — leave empty for a text input)</p>
            {clozeGaps.map((g, i) => <div key={i} className="mb-1.5 flex items-center gap-1.5">
              <span className="w-8 font-mono text-xs text-brand">{`{{${g.n}}}`}</span>
              <input value={g.answer} placeholder="correct answer" onChange={(e) => { const n = [...clozeGaps]; n[i] = { ...g, answer: e.target.value }; setClozeGaps(n); }} className={`${inputClass} py-1.5`} />
              <input value={g.options} placeholder="options: issue / present / habit" onChange={(e) => { const n = [...clozeGaps]; n[i] = { ...g, options: e.target.value }; setClozeGaps(n); }} className={`${inputClass} py-1.5`} />
              <button onClick={() => setClozeGaps(clozeGaps.filter((_, j) => j !== i))} className="text-muted hover:text-ink">×</button>
            </div>)}
            <button onClick={() => setClozeGaps([...clozeGaps, { n: clozeGaps.length + 1, answer: "", options: "" }])} className={dashBtn}>+ blank</button>
          </div>}

          {errors.length > 0 && <div className="rounded-xl border border-red-300 bg-red-500/10 p-3">
            <p className="text-sm font-bold text-red-600">Could not save:</p>
            {errors.map((e, i) => <p key={i} className="text-sm text-ink">• {e}</p>)}
          </div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {editing ? "Save changes" : "Save exercise"}</Button>
        </div>
        </>}
      </div>
    </div>
  );
}
