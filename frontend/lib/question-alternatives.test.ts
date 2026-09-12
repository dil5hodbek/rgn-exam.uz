import { describe, expect, it, vi } from "vitest";
import { emptyQ, locateAlternatives, matchAlternatives, shuffleQuestionOrder } from "./question-alternatives";

describe("locateAlternatives", () => {
  it("finds the two option values around a slash in the prompt", () => {
    const result = locateAlternatives("I have / has got a car.", ["have", "has"]);
    expect(result).toEqual({ start: 2, end: 12, first: "have", second: "has" });
  });

  it("returns null when there are not exactly two options", () => {
    expect(locateAlternatives("a / b", ["a", "b", "c"])).toBeNull();
    expect(locateAlternatives("a / b", ["a"])).toBeNull();
  });

  it("returns null when the prompt has no slash", () => {
    expect(locateAlternatives("no alternative here", ["a", "b"])).toBeNull();
  });
});

describe("matchAlternatives", () => {
  it("parses a simple word/word alternative out of the sentence", () => {
    const match = matchAlternatives("She have / has a dog.");
    expect(match?.[1]).toBe("have");
    expect(match?.[2]).toBe("has");
  });

  it("returns null when there is nothing to match", () => {
    expect(matchAlternatives("no alternative here")).toBeNull();
  });
});

describe("shuffleQuestionOrder", () => {
  it("keeps the same two options when shuffling an alternative-based question (just possibly swapped)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9); // force the swap branch
    const q = emptyQ();
    q.prompt = "I have / has got a car.";
    q.options = ["have", "has"];
    const shuffled = shuffleQuestionOrder(q, true);
    expect(new Set(shuffled.options)).toEqual(new Set(["have", "has"]));
    vi.restoreAllMocks();
  });

  it("remaps correctSingle to keep pointing at the same option value after shuffling", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // deterministic shuffle
    const q = emptyQ();
    q.options = ["A", "B", "C"];
    q.correctSingle = 1; // "B"
    const shuffled = shuffleQuestionOrder(q, false);
    expect(shuffled.options[shuffled.correctSingle]).toBe("B");
    vi.restoreAllMocks();
  });

  it("preserves the multiset of options when shuffling without alternatives", () => {
    const q = emptyQ();
    q.options = ["A", "B", "C", "D"];
    const shuffled = shuffleQuestionOrder(q, false);
    expect([...shuffled.options].sort()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("emptyQ", () => {
  it("creates a fresh question with two blank options and sensible defaults", () => {
    const q = emptyQ();
    expect(q.options).toEqual(["", ""]);
    expect(q.points).toBe(1);
    expect(q.isExample).toBe(false);
  });
});
