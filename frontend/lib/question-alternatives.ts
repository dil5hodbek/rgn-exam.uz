export type Question = {
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

export const emptyQ = (): Question => ({
  prompt: "", options: ["", ""], correctSingle: 0, correctMulti: [], correctBinary: "True",
  correctText: "", accepted: "", caseSensitive: false, normalizeSpaces: true,
  explanation: "", points: 1, isExample: false, open: false,
});

// Finds where the two known alternative phrases sit around the "/" in the
// prompt, the same way exam-runner's inlineAlternative() locates them for
// students — trusting the actual stored option VALUES (which may be multi-word,
// like "have got") rather than re-deriving words from the sentence, which
// can't tell "have" from "have got". Returns the matched span plus which
// option came first, or null if the prompt no longer contains both.
export function locateAlternatives(prompt: string, options: string[]) {
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
export function matchAlternatives(prompt: string) {
  const phrase = prompt.match(/^(.+?)\s*\/\s*(.+?)(?=\s+\S*\([^)]*\))/);
  const word = prompt.match(/([\p{L}'’-]+)\s*\/\s*([\p{L}'’-]+)/u);
  return phrase || word;
}

// Randomly reorders a question's options (or its inline "a / b" alternatives)
// so the correct answer isn't predictably always in the same position —
// remaps correctSingle/correctMulti to keep pointing at the same value.
export function shuffleQuestionOrder(q: Question, hasCorrectAlt: boolean): Question {
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
