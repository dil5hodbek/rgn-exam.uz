import { describe, expect, it } from "vitest";
import {
  answerChoices, choiceGridClass, exampleAnswerText, hasAnswer, inlineAlternative,
  interactionOptions, orderingTokens, scorableQuestions, textAnswer,
  type ApiQuestion, type Exercise,
} from "./exam-helpers";

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "ex-1", type: "multiple_choice", title: "Exercise", instructions: "",
    questions: [], section: { id: "sec-1", title: "Section", tasks: [] },
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<ApiQuestion> = {}): ApiQuestion {
  return { id: "q-1", prompt: "", options: [], points: 1, is_example: false, ...overrides };
}

describe("hasAnswer", () => {
  it("treats empty/whitespace strings, empty arrays, empty objects and null/undefined as unanswered", () => {
    expect(hasAnswer(undefined)).toBe(false);
    expect(hasAnswer(null)).toBe(false);
    expect(hasAnswer("")).toBe(false);
    expect(hasAnswer("   ")).toBe(false);
    expect(hasAnswer([])).toBe(false);
    expect(hasAnswer({})).toBe(false);
  });

  it("treats a non-empty string, array, or object as answered", () => {
    expect(hasAnswer("A")).toBe(true);
    expect(hasAnswer(["A"])).toBe(true);
    expect(hasAnswer({ left: "A" })).toBe(true);
  });
});

describe("textAnswer", () => {
  it("returns the string as-is, and empty string for anything else", () => {
    expect(textAnswer("hello")).toBe("hello");
    expect(textAnswer(undefined)).toBe("");
    expect(textAnswer(null)).toBe("");
    expect(textAnswer(["a", "b"])).toBe("");
  });
});

describe("answerChoices", () => {
  it("returns True/False/Not Given for true_false_not_given exercises", () => {
    const exercise = makeExercise({ type: "true_false_not_given", instructions: "" });
    const question = makeQuestion();
    expect(answerChoices(exercise, question)).toEqual(["True", "False", "Not Given"]);
  });

  it("returns True/False for true_false exercises", () => {
    const exercise = makeExercise({ type: "true_false" });
    const question = makeQuestion();
    expect(answerChoices(exercise, question)).toEqual(["True", "False"]);
  });

  it("extracts option labels from question.options, trimming trailing pipes", () => {
    const exercise = makeExercise({ type: "multiple_choice" });
    const question = makeQuestion({ options: ["Apple |", "Banana", { value: "c", label: "Cherry" }] });
    expect(answerChoices(exercise, question)).toEqual(["Apple", "Banana", "Cherry"]);
  });
});

describe("choiceGridClass", () => {
  it("picks a 2-column layout for two short choices", () => {
    expect(choiceGridClass(["Yes", "No"])).toContain("grid-cols-2");
  });

  it("stacks to one column for long choices", () => {
    const longChoice = "x".repeat(50);
    expect(choiceGridClass([longChoice])).toBe("grid gap-2.5 grid-cols-1");
  });
});

describe("interactionOptions", () => {
  it("normalizes plain string options into {value, label} pairs", () => {
    const exercise = makeExercise({ interaction: { options: ["a", "b"] } });
    expect(interactionOptions(exercise)).toEqual([{ value: "a", label: "a" }, { value: "b", label: "b" }]);
  });

  it("passes through already-structured options unchanged", () => {
    const exercise = makeExercise({ interaction: { options: [{ value: "x", label: "X label" }] } });
    expect(interactionOptions(exercise)).toEqual([{ value: "x", label: "X label" }]);
  });

  it("returns an empty array when there is no interaction", () => {
    expect(interactionOptions(makeExercise())).toEqual([]);
  });
});

describe("inlineAlternative", () => {
  it("locates two known option values around a slash in the prompt", () => {
    const question = makeQuestion({ prompt: "I have / has got a car.", options: ["have", "has"] });
    expect(inlineAlternative(question)).toEqual({
      before: "I ", first: "have", second: "has", after: " got a car.",
    });
  });

  it("returns null when the prompt has no recognizable alternative", () => {
    const question = makeQuestion({ prompt: "No alternative here.", options: [] });
    expect(inlineAlternative(question)).toBeNull();
  });
});

describe("orderingTokens", () => {
  it("prefers question.options when present", () => {
    const question = makeQuestion({ options: ["one", "two"] });
    expect(orderingTokens(question)).toEqual(["one", "two"]);
  });

  it("falls back to parsing the last bracketed group in the prompt", () => {
    const question = makeQuestion({ prompt: "Put in order (cat / dog / bird)", options: [] });
    expect(orderingTokens(question)).toEqual(["cat", "dog", "bird"]);
  });
});

describe("scorableQuestions", () => {
  it("filters out example questions", () => {
    const questions = [makeQuestion({ id: "a" }), makeQuestion({ id: "b", is_example: true })];
    expect(scorableQuestions(questions).map((q) => q.id)).toEqual(["a"]);
  });
});

describe("exampleAnswerText", () => {
  it("joins array example answers with a comma", () => {
    expect(exampleAnswerText(makeQuestion({ example_answer: ["a", "b"] }))).toBe("a, b");
  });

  it("stringifies a scalar example answer", () => {
    expect(exampleAnswerText(makeQuestion({ example_answer: "yes" }))).toBe("yes");
  });

  it("returns an empty string when there is no example answer", () => {
    expect(exampleAnswerText(makeQuestion())).toBe("");
  });
});
