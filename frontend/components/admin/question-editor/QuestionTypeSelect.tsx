"use client";

import { questionTypes } from "@/lib/question-types";

export type Interaction = {
  kind?: string;
  options?: Array<string | { value: string; label: string }>;
  reuse_options?: boolean;
  template?: string;
};

function interactionLines(interaction?: Interaction) {
  return (interaction?.options ?? []).map((option) =>
    typeof option === "string" ? option : `${option.value} | ${option.label}`,
  ).join("\n");
}

function parseInteractionLines(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("|");
    return separator < 0 ? line : {
      value: line.slice(0, separator).trim(),
      label: line.slice(separator + 1).trim(),
    };
  });
}

export function QuestionTypeSelect({
  type, interaction, onTypeChange, onInteractionChange,
}: {
  type: string;
  interaction?: Interaction;
  onTypeChange: (type: string) => void;
  onInteractionChange: (interaction: Interaction) => void;
}) {
  return <div className="grid gap-4">
    <label className="space-y-2 text-sm font-bold text-ink">Question type
      <select
        className="h-12 w-full rounded-xl border border-line bg-canvas px-4 text-sm"
        value={type}
        onChange={(event) => onTypeChange(event.target.value)}
      >
        {questionTypes.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
      </select>
    </label>
    <div className="rounded-2xl border border-indigo-200 bg-indigo-500/[.035] p-4">
      <label className="space-y-2 text-sm font-bold text-ink">Student interaction
        <select
          className="h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm"
          value={interaction?.kind ?? ""}
          onChange={(event) => onInteractionChange({ ...(interaction ?? {}), kind: event.target.value || undefined })}
        >
          <option value="">Automatic for question type</option>
          <option value="word_bank">Word bank · drag or click</option>
          <option value="matching">Matching labels</option>
          <option value="inline_alternatives">Inline alternatives · bad / bed</option>
          <option value="cloze_passage">Multi-gap passage</option>
          <option value="ordering">Ordering</option>
        </select>
      </label>
      {["word_bank", "matching"].includes(interaction?.kind ?? "") && <>
        <label className="mt-3 block space-y-2 text-xs font-bold text-muted">
          Available answers · one per line{interaction?.kind === "matching" && " · value | label"}
          <textarea
            className="min-h-24 w-full rounded-xl border border-line bg-canvas p-3 text-sm text-ink"
            value={interactionLines(interaction)}
            onChange={(event) => onInteractionChange({ ...(interaction ?? {}), options: parseInteractionLines(event.target.value) })}
          />
        </label>
        <label className="mt-3 flex items-center justify-between text-sm font-semibold text-ink">Answers may be reused
          <input
            type="checkbox"
            checked={interaction?.reuse_options ?? false}
            onChange={(event) => onInteractionChange({ ...(interaction ?? {}), reuse_options: event.target.checked })}
            className="h-4 w-4 accent-indigo-600"
          />
        </label>
      </>}
      {interaction?.kind === "cloze_passage" && <label className="mt-3 block space-y-2 text-xs font-bold text-muted">
        Passage template · use {"{{1}}"}, {"{{2}}"} for gaps
        <textarea
          className="min-h-32 w-full rounded-xl border border-line bg-canvas p-3 font-mono text-sm text-ink"
          value={interaction.template ?? ""}
          onChange={(event) => onInteractionChange({ ...(interaction ?? {}), template: event.target.value })}
        />
      </label>}
    </div>
  </div>;
}
