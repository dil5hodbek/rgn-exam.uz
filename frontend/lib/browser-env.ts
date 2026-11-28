/**
 * Where is the page running? Fullscreen works in Chrome/Edge/Firefox/Samsung
 * Internet (Android + desktop) and Safari on iPad/Mac — but not in an app's
 * built-in browser (Telegram, Instagram…) and not on iPhone at all, where the
 * only full-screen option is the home-screen app.
 */
export type BrowserEnv = {
  os: "android" | "ios" | "other";
  /** Name of the app whose built-in browser this is, or null. */
  inApp: string | null;
  /** Opened from the home screen (no browser bars at all). */
  standalone: boolean;
};

const IN_APP: [RegExp, string][] = [
  [/Telegram/i, "Telegram"],
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/WhatsApp/i, "WhatsApp"],
  [/musical_ly|TikTok|BytedanceWebview/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/Line\//i, "LINE"],
  [/MicroMessenger/i, "WeChat"],
];

export function detectBrowser(ua = navigator.userAgent): BrowserEnv {
  const ios = /iPhone|iPod/i.test(ua) || (/iPad|Macintosh/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const os = /Android/i.test(ua) ? "android" : ios ? "ios" : "other";
  let inApp = IN_APP.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  // Telegram & co. on Android are a plain WebView ("; wv)") — name not always in the UA.
  if (!inApp && os === "android" && /; wv\)/.test(ua)) inApp = "app";
  // iOS in-app views (WKWebView) lack the "Safari/" token every real iOS browser has.
  if (!inApp && os === "ios" && !/Safari\//.test(ua)) inApp = "app";
  const standalone = typeof window !== "undefined" && (
    window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: fullscreen)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
  return { os, inApp: standalone ? null : inApp, standalone };
}

/** Android intent that opens `url` in Chrome (falls back to the URL itself). */
export function chromeIntent(url: string) {
  const parsed = new URL(url);
  return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=${parsed.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
