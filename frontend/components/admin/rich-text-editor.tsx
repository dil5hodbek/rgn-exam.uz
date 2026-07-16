"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Check, Italic, List, ListOrdered, Maximize2, Pencil, RemoveFormatting, Underline, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasHtmlContent, sanitizeHtml } from "@/lib/sanitize";

// execCommand is deprecated but universally supported and dependency-free —
// the right tool for a small bold/italic/size/list toolbar without pulling in
// a heavy editor library.
function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

function ToolBtn({ icon: Icon, cmd, value, title }: { icon: typeof Bold; cmd: string; value?: string; title: string }) {
  return (
    <button
      type="button"
      title={title}
      // onMouseDown + preventDefault keeps the text selection inside the editor
      // (a normal click would blur it and the command would apply to nothing).
      onMouseDown={(event) => { event.preventDefault(); exec(cmd, value); }}
      className="grid h-9 w-9 place-items-center rounded-lg text-ink transition hover:bg-surface"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

const SIZES: [string, string][] = [["2", "A−"], ["3", "A"], ["5", "A+"], ["7", "A++"]];

export function RichTextEditorModal({ initialHtml, title, onSave, onClose }: {
  initialHtml: string; title: string; onSave: (html: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) { ref.current.innerHTML = initialHtml || ""; ref.current.focus(); }
  }, [initialHtml]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-canvas">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-extrabold text-ink">{title}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}><X className="h-4 w-4" /> Cancel</Button>
          <Button onClick={() => onSave(sanitizeHtml(ref.current?.innerHTML ?? ""))}><Check className="h-4 w-4" /> Save</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
        <ToolBtn icon={Bold} cmd="bold" title="Bold" />
        <ToolBtn icon={Italic} cmd="italic" title="Italic" />
        <ToolBtn icon={Underline} cmd="underline" title="Underline" />
        <span className="mx-1 h-5 w-px bg-line" />
        <span className="px-1 text-[11px] font-bold text-muted">Text size:</span>
        {SIZES.map(([size, label]) => (
          <button
            key={size} type="button" title={`Size ${label}`}
            onMouseDown={(event) => { event.preventDefault(); exec("fontSize", size); }}
            className="grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold text-ink transition hover:bg-surface"
          >{label}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <ToolBtn icon={List} cmd="insertUnorderedList" title="Bullet list" />
        <ToolBtn icon={ListOrdered} cmd="insertOrderedList" title="Numbered list" />
        <ToolBtn icon={RemoveFormatting} cmd="removeFormat" title="Clear formatting" />
      </div>
      <div className="flex-1 overflow-y-auto bg-surface px-4 py-6">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Type or paste your text here…"
          className="passage-content mx-auto min-h-full w-full max-w-3xl rounded-2xl border border-line bg-canvas p-6 text-[15px] leading-8 text-ink outline-none"
        />
      </div>
    </div>
  );
}

// Inline field: a compact preview + Edit button. Editing happens full-screen so
// long passages are comfortable to work with.
export function RichTextField({ label, value, onChange, onRemove }: {
  label: string; value: string; onChange: (html: string) => void; onRemove?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasContent = hasHtmlContent(value);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-bold text-muted">{label}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-bold text-brand hover:underline">
            {hasContent ? <><Pencil className="h-3.5 w-3.5" /> Edit</> : <><Maximize2 className="h-3.5 w-3.5" /> Write full-screen</>}
          </button>
          {onRemove && <button type="button" onClick={onRemove} className="text-xs text-muted hover:text-ink">× remove</button>}
        </div>
      </div>
      {hasContent
        ? <div
            onClick={() => setEditing(true)}
            className="passage-content max-h-44 cursor-pointer overflow-hidden rounded-lg border border-line bg-canvas p-3 text-sm leading-7 text-ink"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
          />
        : <button type="button" onClick={() => setEditing(true)} className="w-full rounded-lg border border-dashed border-line bg-canvas p-4 text-sm text-muted hover:border-brand">
            + Click to add text (bold, size, and more)
          </button>}
      {editing && <RichTextEditorModal
        initialHtml={value}
        title={label}
        onSave={(html) => { onChange(html); setEditing(false); }}
        onClose={() => setEditing(false)}
      />}
    </div>
  );
}
