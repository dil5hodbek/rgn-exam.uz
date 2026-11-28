// Unit tests number their variants as units ("Unit 3"); Mid-course and
// End-course keep "Variant 3".
export const isUnitType = (slugOrName?: string | null) => !!slugOrName && /unit/i.test(slugOrName);

/** "U3" / "V3" — for tight badges. */
export const variantTag = (slugOrName: string | null | undefined, number: number) => `${isUnitType(slugOrName) ? "U" : "V"}${number}`;

/** "Unit 3" / "Variant 3". */
export const variantName = (slugOrName: string | null | undefined, number: number, variantWord = "Variant") =>
  `${isUnitType(slugOrName) ? "Unit" : variantWord} ${number}`;
