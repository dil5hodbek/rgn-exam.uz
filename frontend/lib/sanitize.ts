// Strip anything script-like from admin-authored rich text before it is stored
// or rendered to students. The toolbar only ever emits simple formatting tags;
// this is defence in depth.
export function sanitizeHtml(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "")
    .replace(/ on\w+='[^']*'/gi, "");
}

// True when the string carries real text (once tags are removed).
export function hasHtmlContent(html?: string | null): boolean {
  return Boolean(html && html.replace(/<[^>]*>/g, "").trim());
}
