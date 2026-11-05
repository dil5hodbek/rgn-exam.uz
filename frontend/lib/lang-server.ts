import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, type Lang } from "./lang";

export function getLang(): Lang {
  return parseLang(cookies().get(LANG_COOKIE)?.value);
}

// Server-component counterpart of useLang().t
export function getT() {
  const lang = getLang();
  return (uz: string, en: string) => (lang === "uz" ? uz : en);
}
