"use client";

import type { DragEvent as ReactDragEvent } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  exampleAnswerText, hasAnswer, interactionOptions, textAnswer,
  type AnswerValue, type ApiQuestion, type Exercise, type ExerciseResult,
} from "@/lib/exam-helpers";
import { cn } from "@/lib/utils";

type GapPick = { pool: "word" | "reply"; value: string } | null;

// Two-part coursebook exercise: word box (left) fills the gaps, replies
// (right) match each completed question. Questions alternate word/reply
// rows in the data; the UI shows them as one row per item.
export function GapMatch({
  exercise, answers, exerciseResults, gapPick, setGapPick, setAnswer,
}: {
  exercise: Exercise;
  answers: Record<string, AnswerValue>;
  exerciseResults: ExerciseResult;
  gapPick: GapPick;
  setGapPick: (value: GapPick) => void;
  setAnswer: (questionId: string, answer: AnswerValue) => void;
}) {
  const sorted = [...exercise.questions].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const rows: { word: ApiQuestion; reply: ApiQuestion }[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) rows.push({ word: sorted[i], reply: sorted[i + 1] });
  const words = exercise.interaction?.words ?? [];
  const replies = interactionOptions(exercise);
  const usedWords = new Set(rows.map(({ word }) => (word.is_example ? exampleAnswerText(word) : textAnswer(answers[word.id]))).filter(Boolean));
  const usedReplies = new Set(rows.map(({ reply }) => textAnswer(answers[reply.id])).filter(Boolean));

  const slotClass = (filled: boolean, result: boolean | null | undefined, receptive: boolean) => cn(
    "inline-flex min-h-9 max-w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-2.5 py-1 text-sm font-bold align-baseline transition",
    result === true ? "border-emerald-400 bg-emerald-500/10 text-emerald-700"
      : result === false ? "border-red-400 bg-red-500/10 text-red-700"
      : filled ? "border-brand bg-orange-500/5 text-ink"
      : receptive ? "animate-pulse border-brand bg-orange-500/10 text-brand"
      : "border-line bg-surface text-muted hover:border-orange-300",
  );

  function place(question: ApiQuestion, pool: "word" | "reply") {
    if (gapPick?.pool === pool) {
      setAnswer(question.id, gapPick.value);
      setGapPick(null);
    } else if (hasAnswer(answers[question.id])) {
      setAnswer(question.id, "");
    }
  }

  // Chips can be dragged with the cursor and dropped on a slot; clicking
  // (pick → place) still works everywhere, including touch screens.
  const dragProps = (pool: "word" | "reply", value: string) => ({
    draggable: true,
    onDragStart: (event: ReactDragEvent) => {
      event.dataTransfer.setData("text/plain", JSON.stringify({ pool, value }));
      event.dataTransfer.effectAllowed = "move";
      setGapPick({ pool, value });
    },
    onDragEnd: () => setGapPick(null),
  });
  const dropProps = (question: ApiQuestion, pool: "word" | "reply") => ({
    onDragOver: (event: ReactDragEvent) => { if (gapPick?.pool === pool) event.preventDefault(); },
    onDrop: (event: ReactDragEvent) => {
      event.preventDefault();
      try {
        const data = JSON.parse(event.dataTransfer.getData("text/plain"));
        if (data?.pool === pool && typeof data.value === "string") setAnswer(question.id, data.value);
      } catch { /* not one of our chips */ }
      setGapPick(null);
    },
  });

  return <div className="space-y-4 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_250px] lg:gap-4 lg:space-y-0">
    {/* Word box — left column */}
    <aside className="rounded-2xl border border-orange-200 bg-orange-500/[.035] p-4 lg:sticky lg:top-2 lg:col-start-1 lg:row-start-1 lg:self-start">
      <p className="text-xs font-bold uppercase tracking-wider text-brand">Word box</p>
      <p className="mt-1 text-[11px] leading-4 text-muted">Pick a word, then click a gap. Each word is used once.</p>
      <div className="mt-3 flex flex-wrap gap-2 lg:flex-col">
        {words.map((word) => {
          const used = usedWords.has(word);
          const picked = gapPick?.pool === "word" && gapPick.value === word;
          return <button key={word} type="button" disabled={used}
            {...(used ? {} : dragProps("word", word))}
            onClick={() => setGapPick(picked ? null : { pool: "word", value: word })}
            className={cn(
              "rounded-lg border-2 px-3 py-2 text-left text-sm font-bold transition",
              used ? "cursor-not-allowed border-line bg-surface text-muted/40 line-through"
                : picked ? "cursor-grabbing border-brand bg-brand text-white shadow-md shadow-orange-500/25"
                : "cursor-grab border-line bg-canvas text-ink hover:border-brand hover:text-brand active:cursor-grabbing",
            )}>{word}</button>;
        })}
      </div>
    </aside>

    {/* Questions — centre column */}
    <div className="space-y-3 lg:col-start-2 lg:row-start-1">
      {rows.map(({ word, reply }, index) => {
        const parts = word.prompt.split(/_{2,}/);
        const wordResult = exerciseResults[word.id];
        const replyResult = exerciseResults[reply.id];
        const wordValue = word.is_example ? exampleAnswerText(word) : textAnswer(answers[word.id]);
        const replyValue = textAnswer(answers[reply.id]);
        const replyLabel = replies.find((option) => option.value === replyValue)?.label ?? "";
        return <article key={word.id} id={`q-${word.id}`} className="scroll-mt-4 rounded-2xl border border-line bg-canvas p-4 transition-all hover:border-orange-200/70 sm:p-5">
          <div className="flex items-start gap-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface text-sm font-extrabold text-muted">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold leading-9 text-ink sm:text-lg">
                {parts[0]}
                {word.is_example
                  ? <span className="mx-1 inline-flex min-w-16 justify-center border-b-2 border-sky-400 px-1 font-extrabold text-sky-600">{wordValue}</span>
                  : <button type="button" onClick={() => place(word, "word")} {...dropProps(word, "word")} className={cn("mx-1", slotClass(!!wordValue, wordResult, gapPick?.pool === "word"))}>
                      {wordValue || "word"}
                      {wordResult === true && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                      {wordResult === false && <XCircle className="h-4 w-4 shrink-0" />}
                    </button>}
                {parts.slice(1).join("___")}
              </p>
              <div className="mt-2.5 flex items-center gap-2" id={`q-${reply.id}`}>
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Reply</span>
                <button type="button" onClick={() => place(reply, "reply")} {...dropProps(reply, "reply")} className={slotClass(!!replyValue, replyResult, gapPick?.pool === "reply")}>
                  {replyValue
                    ? <><b className="shrink-0 text-brand">{replyValue})</b><span className="truncate">{replyLabel}</span></>
                    : "match the reply"}
                  {replyResult === true && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  {replyResult === false && <XCircle className="h-4 w-4 shrink-0" />}
                </button>
              </div>
              {word.is_example && <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-600"><CheckCircle2 className="h-3.5 w-3.5" /> Example word — not scored</p>}
            </div>
          </div>
        </article>;
      })}
    </div>

    {/* Replies — right column */}
    <aside className="rounded-2xl border border-orange-200 bg-orange-500/[.035] p-4 lg:sticky lg:top-2 lg:col-start-3 lg:row-start-1 lg:self-start">
      <p className="text-xs font-bold uppercase tracking-wider text-brand">Replies</p>
      <p className="mt-1 text-[11px] leading-4 text-muted">Pick a reply, then click “match the reply” under a question.</p>
      <div className="mt-3 space-y-2">
        {replies.map((option) => {
          const used = usedReplies.has(option.value);
          const picked = gapPick?.pool === "reply" && gapPick.value === option.value;
          return <button key={option.value} type="button" disabled={used}
            {...(used ? {} : dragProps("reply", option.value))}
            onClick={() => setGapPick(picked ? null : { pool: "reply", value: option.value })}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg border-2 p-2.5 text-left text-xs font-semibold leading-5 transition",
              used ? "cursor-not-allowed border-line bg-surface text-muted/40"
                : picked ? "cursor-grabbing border-brand bg-brand text-white shadow-md shadow-orange-500/25"
                : "cursor-grab border-line bg-canvas text-ink hover:border-brand active:cursor-grabbing",
            )}>
            <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded font-extrabold", picked ? "bg-white/20 text-white" : "bg-surface text-brand")}>{option.value}</span>
            <span className="min-w-0">{option.label}</span>
          </button>;
        })}
      </div>
    </aside>
  </div>;
}
