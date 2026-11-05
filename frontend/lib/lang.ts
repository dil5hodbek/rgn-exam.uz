// Shared by server and client code; the React context lives in i18n.tsx.
export type Lang = "uz" | "en";

export const LANG_COOKIE = "lang";
export const DEFAULT_LANG: Lang = "uz";

export function parseLang(value: string | undefined): Lang {
  return value === "en" || value === "uz" ? value : DEFAULT_LANG;
}
