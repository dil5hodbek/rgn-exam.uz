"use client";
/**
 * Sign-in / sign-up shell in the Registon "Bilim — kelajak poydevori" design:
 * orange card, logo intro (once per browser session), compact layout while
 * the phone keyboard is open, +998 phone formatting and password eye toggles.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export type Role = "STUDENT" | "TEACHER" | "EXAMINER" | "ADMIN" | "SUPER_ADMIN";
export type AuthResult = { user: { role: Role } };

export function landingFor(role: Role) {
  if (role === "STUDENT") return "/dashboard";
  if (role === "TEACHER") return "/monitor";
  if (role === "EXAMINER") return "/examiner";
  return "/admin";
}

/** Someone who is still signed in (old bookmark, shared link) goes straight to their panel. */
export function useRedirectIfSignedIn() {
  useEffect(() => {
    api<{ role: Role }>("/auth/me")
      .then((user) => window.location.replace(landingFor(user.role)))
      .catch(() => undefined);
  }, []);
}

export function openTelegram(start: "signin" | "signup") {
  const username = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "rgnmockimtihon_bot").replace(/^@/, "");
  window.location.assign(`https://t.me/${encodeURIComponent(username)}?start=${start}`);
}

const LOGO = "/auth/registon.svg";
const INTRO_KEY = "rgn-auth-intro";

export function EntryShell({ children }: { children: ReactNode }) {
  const { t } = useLang();
  const rootRef = useRef<HTMLDivElement>(null);
  const [intro, setIntro] = useState(true);
  const [transfer, setTransfer] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  // Logo intro: the big logo flies into the card's logo, then the panel rises.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const skip = document.documentElement.getAttribute("data-auth-intro") === "skip"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (skip) { setIntro(false); return; }
    const overlay = root.querySelector<HTMLElement>(".intro");
    const flight = root.querySelector<HTMLElement>(".intro-flight");
    const brand = root.querySelector<HTMLElement>(".demo-hero .brand");
    const panel = root.querySelector<HTMLElement>(".demo-panel");
    const card = root.querySelector<HTMLElement>(".demo-card");
    if (!overlay || !flight || !brand || !panel || !card) return;
    const measure = () => {
      const box = overlay.getBoundingClientRect();
      const target = brand.getBoundingClientRect();
      const width = Number.parseFloat(getComputedStyle(flight).width) || 1;
      flight.style.setProperty("--logo-x", `${target.left + target.width / 2 - box.left - box.width / 2}px`);
      flight.style.setProperty("--logo-y", `${target.top + target.height / 2 - box.top - box.height / 2}px`);
      flight.style.setProperty("--logo-scale", String(target.width / width));
    };
    measure();
    setTransfer(true);
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    window.addEventListener("resize", measure);
    const done = (event: AnimationEvent) => {
      if (event.target !== panel) return;
      try { sessionStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ }
      document.documentElement.setAttribute("data-auth-intro", "skip");
      setIntro(false);
      setTransfer(false);
    };
    panel.addEventListener("animationend", done);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      panel.removeEventListener("animationend", done);
    };
  }, []);

  // Phones: while the keyboard is open, shrink the hero so the form stays in view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const touch = window.matchMedia("(pointer: coarse)");
    const viewport = window.visualViewport;
    let width = window.innerWidth;
    let fullHeight = viewport?.height ?? window.innerHeight;
    let keyboardOpen = false;
    const isField = (element: Element | null) => element instanceof HTMLInputElement && root.contains(element);
    const show = () => {
      setKeyboard(true);
      requestAnimationFrame(() => { if (isField(document.activeElement) && window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); });
    };
    const onFocus = (event: Event) => { if (touch.matches && isField(event.target as Element)) show(); };
    const onBlur = () => requestAnimationFrame(() => { if (!keyboardOpen && !isField(document.activeElement)) setKeyboard(false); });
    const sync = () => {
      if (!touch.matches || (viewport && Math.abs(viewport.scale - 1) > 0.02)) return;
      const visible = viewport?.height ?? window.innerHeight;
      if (width !== window.innerWidth) { width = window.innerWidth; fullHeight = visible; keyboardOpen = false; }
      fullHeight = Math.max(fullHeight, visible);
      const open = fullHeight - visible >= 100;
      if (open === keyboardOpen) return;
      keyboardOpen = open;
      if (open && isField(document.activeElement)) show(); else setKeyboard(false);
    };
    root.addEventListener("focusin", onFocus);
    root.addEventListener("focusout", onBlur);
    viewport?.addEventListener("resize", sync);
    window.addEventListener("resize", sync);
    return () => {
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onBlur);
      viewport?.removeEventListener("resize", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  const className = ["rgn-auth", intro && "play-intro", transfer && "intro-transfer", keyboard && "keyboard-layout"].filter(Boolean).join(" ");
  return <div ref={rootRef} className={className}>
    <div className="intro" aria-hidden="true">
      <div className="intro-backdrop">
        <div className="intro-lockup">
          <div className="intro-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="intro-book" src={LOGO} width={204} height={52} alt="" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="intro-wordmark" src={LOGO} width={204} height={52} alt="" />
          </div>
        </div>
        <div className="intro-curtain">
          <div className="intro-lockup intro-lockup--inverse">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="intro-brand brand-white" src={LOGO} width={204} height={52} alt="" />
          </div>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="intro-brand intro-flight brand-white" src={LOGO} width={204} height={52} alt="" />
    </div>

    <main className="demo">
      <div className="demo-card">
        <header className="demo-hero">
          <a href="/" aria-label={t("Bosh sahifa", "Home")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand brand-white" src={LOGO} width={204} height={52} alt={t("Registon o‘quv markazi", "Registon learning centre")} />
          </a>
          <h1>{t("Bilim — kelajak", "Knowledge — the")}<br />{t("poydevori", "future's foundation")}</h1>
        </header>
        <section className="demo-panel">{children}</section>
      </div>
    </main>
  </div>;
}

function EyeIcon({ open }: { open: boolean }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {open
      ? <g><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.6" /></g>
      : <g><path d="M9.9 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a14 14 0 0 1-3.1 3.3M15.7 17.3a10 10 0 0 1-3.7.7c-6.5 0-10-6-10-6a15 15 0 0 1 4.3-4.3M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8M3 3l18 18" /></g>}
  </svg>;
}

export function PasswordField({ value, onChange, placeholder, label, autoComplete, showLabel, hideLabel }: {
  value: string; onChange: (value: string) => void; placeholder: string; label: string;
  autoComplete: string; showLabel: string; hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="demo-input">
    <input type={visible ? "text" : "password"} autoComplete={autoComplete} aria-label={label} maxLength={128}
      placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required />
    <button type="button" className="eye-toggle" aria-label={visible ? hideLabel : showLabel} aria-pressed={visible} onClick={() => setVisible(!visible)}>
      <EyeIcon open={visible} />
    </button>
  </div>;
}

export function TelegramIcon() {
  return <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
    <path fill="currentColor" d="M21.9 4.3 18.6 20c-.25 1.1-.9 1.35-1.83.84l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.01.5l.36-5.15 9.39-8.49c.41-.36-.09-.56-.64-.2L5.76 13.45.77 11.9c-1.08-.34-1.1-1.08.22-1.6L20.5 2.78c.9-.33 1.7.21 1.4 1.52Z" />
  </svg>;
}

// --- +998 phone field ------------------------------------------------------
const PHONE_DIGITS = 9;
const digitsOnly = (value: string) => value.replace(/\D/g, "");
const groupPhone = (digits: string) => [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean).join(" ");
/** Sign-in also takes a username an examiner gave the student (starts with a letter). */
export const isUsernameInput = (value: string) => /^[A-Za-z]/.test(value.trim());

/**
 * "90 000 00 00" with a fixed +998 prefix: digits only, grouped as you type,
 * the caret kept in place, a pasted +998… number trimmed. With
 * `allowUsername`, a value starting with a letter is taken as a username.
 */
export function PhoneField({ value, onChange, allowUsername = false, autoComplete, label, placeholder }: {
  value: string; onChange: (value: string) => void; allowUsername?: boolean;
  autoComplete: string; label: string; placeholder: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const username = allowUsername && isUsernameInput(value);

  const apply = useCallback((raw: string, caretInRaw: number) => {
    if (allowUsername && isUsernameInput(raw)) {
      onChange(raw.replace(/\s/g, ""));
      return;
    }
    const input = digitsOnly(raw);
    const prefix = input.length === 12 && input.startsWith("998") ? 3 : 0;
    const digits = input.slice(prefix, prefix + PHONE_DIGITS);
    const formatted = groupPhone(digits);
    let before = digitsOnly(raw.slice(0, caretInRaw)).length - prefix;
    let position = 0;
    while (position < formatted.length && before > 0) {
      if (formatted[position] !== " ") before--;
      position++;
    }
    caret.current = position;
    onChange(formatted);
  }, [allowUsername, onChange]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && caret.current !== null && document.activeElement === element) {
      element.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  }, [value]);

  // Digits only (unless typing a username); deleting across a space removes the digit beside it.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onBeforeInput = (event: InputEvent) => {
      if (!event.cancelable) return;
      const { value: current, selectionStart, selectionEnd } = element;
      const start = selectionStart ?? current.length;
      const end = selectionEnd ?? start;
      const typingUsername = allowUsername && (isUsernameInput(current) || (current.trim() === "" && /^[A-Za-z]$/.test(event.data ?? "")));
      if (typingUsername) return;
      if (event.inputType === "insertText" && event.data?.length === 1) {
        const room = PHONE_DIGITS - digitsOnly(current.slice(0, start) + current.slice(end)).length;
        if (!/^[0-9]$/.test(event.data) || room <= 0) event.preventDefault();
        return;
      }
      if (start !== end) return;
      if (event.inputType === "deleteContentBackward" && current[start - 1] === " ") {
        event.preventDefault();
        apply(current.slice(0, start - 2) + current.slice(start), start - 2);
      } else if (event.inputType === "deleteContentForward" && current[start] === " ") {
        event.preventDefault();
        apply(current.slice(0, start) + current.slice(start + 2), start);
      }
    };
    element.addEventListener("beforeinput", onBeforeInput);
    return () => element.removeEventListener("beforeinput", onBeforeInput);
  }, [allowUsername, apply]);

  function onPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").trim();
    if (allowUsername && isUsernameInput(pasted)) return;
    event.preventDefault();
    const element = event.currentTarget;
    const full = /^\+?998([1-9]\d{8})$/.exec(pasted.replace(/[\s()-]/g, ""));
    if (pasted.startsWith("+") && !full) return;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const room = PHONE_DIGITS - digitsOnly(element.value.slice(0, start) + element.value.slice(end)).length;
    const digits = (full?.[1] ?? digitsOnly(pasted)).slice(0, room);
    if (!digits) return;
    const raw = element.value.slice(0, start) + digits + element.value.slice(end);
    apply(raw, start + digits.length);
  }

  return <div className="demo-input">
    {!username && <span aria-hidden="true">+998</span>}
    <input ref={ref} type={allowUsername ? "text" : "tel"} inputMode={allowUsername ? "text" : "numeric"}
      autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
      aria-label={label} maxLength={allowUsername ? 40 : 12} placeholder={placeholder} value={value}
      onChange={(event) => apply(event.target.value, event.target.selectionStart ?? event.target.value.length)}
      onPaste={onPaste} required />
  </div>;
}

/** Value to send to the API: the full +998 number, or the username as typed. */
export function phoneForApi(value: string) {
  return isUsernameInput(value) ? value.trim() : `+998${digitsOnly(value)}`;
}

export const phoneComplete = (value: string) => isUsernameInput(value) ? value.trim().length >= 3 : digitsOnly(value).length === PHONE_DIGITS;
