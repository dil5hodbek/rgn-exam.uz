import { describe, expect, it } from "vitest";
import { chromeIntent, detectBrowser } from "./browser-env";

const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const TELEGRAM_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Telegram-Android/11.5.3";
const WEBVIEW_ANDROID = "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const WKWEBVIEW_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const INSTAGRAM_IPHONE = `${WKWEBVIEW_IPHONE} Instagram 356.0.0.0 (iPhone15,2; iOS 18_1)`;
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("detectBrowser", () => {
  it("knows real browsers from in-app ones", () => {
    expect(detectBrowser(CHROME_ANDROID)).toMatchObject({ os: "android", inApp: null });
    expect(detectBrowser(TELEGRAM_ANDROID)).toMatchObject({ os: "android", inApp: "Telegram" });
    expect(detectBrowser(WEBVIEW_ANDROID)).toMatchObject({ os: "android", inApp: "app" });
    expect(detectBrowser(SAFARI_IPHONE)).toMatchObject({ os: "ios", inApp: null });
    expect(detectBrowser(CHROME_IPHONE)).toMatchObject({ os: "ios", inApp: null });
    expect(detectBrowser(WKWEBVIEW_IPHONE)).toMatchObject({ os: "ios", inApp: "app" });
    expect(detectBrowser(INSTAGRAM_IPHONE)).toMatchObject({ os: "ios", inApp: "Instagram" });
    expect(detectBrowser(DESKTOP)).toMatchObject({ os: "other", inApp: null });
  });
});

describe("chromeIntent", () => {
  it("reopens the same address in Chrome with a fallback", () => {
    const url = "https://rgn-exam.uz/continue?code=abc&next=%2Fexam-session%2F1";
    expect(chromeIntent(url)).toBe(
      "intent://rgn-exam.uz/continue?code=abc&next=%2Fexam-session%2F1#Intent;scheme=https;package=com.android.chrome;"
      + `S.browser_fallback_url=${encodeURIComponent(url)};end`,
    );
  });
});
