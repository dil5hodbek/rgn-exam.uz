"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import "./landing.css";

type Lang = "uz" | "en";

const LEVELS = ["Beginner", "Elementary", "Pre-Intermediate", "Intermediate"];
const SKILLS = ["Listening", "Reading", "Grammar", "Vocabulary", "Writing"] as const;

// The sample question in the hero is a real item type from the platform
// (inline alternatives) so visitors try the exam itself, not a picture of it.
const SAMPLE = { before: "If I were you, I", after: "more for the exam.", options: ["will study", "would study"], answer: "would study" };

const dict = {
  uz: {
    navLevels: "Darajalar",
    navHow: "Qanday ishlaydi",
    signIn: "Kirish",
    signUp: "Ro'yxatdan o'tish",
    eyebrow: "Registon o'quv markazi · Ingliz tili imtihonlari",
    h1: "Bilganingizni imtihonda ko'rsating",
    lead: "Registon o'quvchilari uchun Mid-course va End-course imtihonlari. Listening, Reading, Grammar, Vocabulary va Writing bitta testda — natijani topshirganingizdan keyin ko'rasiz.",
    start: "Imtihonni boshlash",
    create: "Hisob yaratish",
    note: "Telefon raqamingiz bilan kirasiz. Har bir imtihon 60 daqiqa.",
    tryLabel: "Bir savolni sinab ko'ring",
    pick: "To'g'ri variantni bosing.",
    right: "To'g'ri. \"If I were you\" dan keyin would + fe'l keladi.",
    wrong: "Bu yerda \"would study\" bo'ladi: \"If I were you\" dan keyin would + fe'l keladi.",
    more: "Qolgan savollar imtihonda",
    again: "Qaytadan",
    levelsTitle: "To'rt daraja, har birida ikkita imtihon",
    levelStep: (n: number) => `${n}-daraja`,
    howTitle: "Qanday ishlaydi",
    steps: [
      ["Hisobingizga kiring", "Telefon raqamingiz bilan ro'yxatdan o'ting yoki kiring."],
      ["Imtihonni tanlang", "O'qiyotgan darajangiz va imtihon turini tanlang: Mid-course yoki End-course."],
      ["Testni yeching", "60 daqiqa vaqtingiz bor. Javoblar o'zi saqlanadi, chiqib ketsangiz ham yo'qolmaydi."],
      ["Natijani ko'ring", "Har bir mashq bo'yicha ball va qaysi savolda xato qilganingiz."],
    ],
    skillsTitle: "Imtihonda nima bor",
    skills: {
      Listening: "Yozuvni tinglab, savollarga javob berasiz.",
      Reading: "Matnni o'qib, savollarga javob berasiz.",
      Grammar: "To'g'ri shaklni tanlaysiz yoki yozasiz.",
      Vocabulary: "Kursda o'tilgan so'zlar tekshiriladi.",
      Writing: "Qisqa matn yozasiz — u ham baholanadi.",
    },
    ctaTitle: "Kurs tugadimi? Imtihon sizni kutyapti.",
    footer: "Registon o'quv markazi",
    site: "rgn.uz",
  },
  en: {
    navLevels: "Levels",
    navHow: "How it works",
    signIn: "Sign in",
    signUp: "Sign up",
    eyebrow: "Registon Learning Center · English exams",
    h1: "Show what you know in the exam",
    lead: "Mid-course and End-course exams for Registon students. Listening, Reading, Grammar, Vocabulary and Writing in one test — you see your result right after you submit.",
    start: "Start the exam",
    create: "Create an account",
    note: "You sign in with your phone number. Each exam takes 60 minutes.",
    tryLabel: "Try one question",
    pick: "Tap the correct option.",
    right: "Correct. After \"If I were you\" we use would + verb.",
    wrong: "It's \"would study\" here: after \"If I were you\" we use would + verb.",
    more: "The rest are in the exam",
    again: "Try again",
    levelsTitle: "Four levels, two exams each",
    levelStep: (n: number) => `Level ${n}`,
    howTitle: "How it works",
    steps: [
      ["Sign in", "Create an account or sign in with your phone number."],
      ["Pick your exam", "Choose the level you study and the exam: Mid-course or End-course."],
      ["Take the test", "You have 60 minutes. Answers save as you go, so leaving the page loses nothing."],
      ["See your result", "A score for every exercise and the questions you got wrong."],
    ],
    skillsTitle: "What's in the exam",
    skills: {
      Listening: "Listen to a recording and answer questions.",
      Reading: "Read a text and answer questions.",
      Grammar: "Choose or write the correct form.",
      Vocabulary: "Words from your course are checked.",
      Writing: "Write a short text — it gets graded too.",
    },
    ctaTitle: "Finished the course? Your exam is ready.",
    footer: "Registon Learning Center",
    site: "rgn.uz",
  },
};

export default function Home() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [lang, setLang] = useState<Lang>("uz");
  const [picked, setPicked] = useState<string | null>(null);
  const authChecked = useRef(false);

  useEffect(() => {
    if (authChecked.current) return;
    authChecked.current = true;
    api<{ role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN" }>("/auth/me")
      .then((user) => {
        if (user.role === "STUDENT") router.replace("/dashboard");
        else if (user.role === "TEACHER") router.replace("/monitor");
        else router.replace("/admin");
      })
      .catch(() => setChecked(true));
  }, [router]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("landing-lang");
      if (saved === "en" || saved === "uz") setLang(saved);
    } catch {
      // Storage can be blocked (private mode) — Uzbek stays the default.
    }
  }, []);

  if (!checked) return null;

  const t = dict[lang];
  const isRight = picked === SAMPLE.answer;

  function toggleLang() {
    const next = lang === "uz" ? "en" : "uz";
    setLang(next);
    try {
      window.localStorage.setItem("landing-lang", next);
    } catch {
      // Not remembering the choice is fine.
    }
  }

  return (
    <div className="landing-root" lang={lang}>
      <header className="lp-nav lp-wrap">
        <Link href="/" className="lp-brand" aria-label="Registon">
          <img src="/brand/registon-full.webp" alt="Registon o'quv markazi" width={2000} height={548} />
        </Link>
        <nav className="lp-links" aria-label="Sahifa">
          <a href="#levels">{t.navLevels}</a>
          <a href="#how">{t.navHow}</a>
        </nav>
        <div className="lp-actions">
          <button type="button" className="lp-lang" onClick={toggleLang} aria-label={lang === "uz" ? "Switch to English" : "O'zbek tiliga o'tish"}>
            {lang === "uz" ? "EN" : "UZ"}
          </button>
          <Link className="lp-btn lp-btn-quiet" href="/sign-in">{t.signIn}</Link>
          <Link className="lp-btn lp-btn-solid lp-hide-sm" href="/create-account">{t.signUp}</Link>
        </div>
      </header>

      <main>
        <section className="lp-hero lp-wrap">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">{t.eyebrow}</p>
            <h1>{t.h1}<span className="lp-dot">.</span></h1>
            <p className="lp-lead">{t.lead}</p>
            <div className="lp-cta-row">
              <Link className="lp-btn lp-btn-solid lp-btn-lg" href="/sign-in">{t.start} <span aria-hidden="true">→</span></Link>
              <Link className="lp-btn lp-btn-line lp-btn-lg" href="/create-account">{t.create}</Link>
            </div>
            <p className="lp-note">{t.note}</p>
          </div>

          <div className="lp-try" aria-live="polite">
            <div className="lp-try-head">
              <span>{t.tryLabel}</span>
              <span className="lp-mono">Grammar · Pre-Intermediate</span>
            </div>
            <p className="lp-try-q">
              {SAMPLE.before}{" "}
              {SAMPLE.options.map((option, index) => (
                <span key={option}>
                  {index > 0 && <span className="lp-slash">/</span>}
                  <button
                    type="button"
                    disabled={!!picked}
                    onClick={() => setPicked(option)}
                    className={[
                      "lp-opt",
                      picked && option === SAMPLE.answer ? "is-right" : "",
                      picked === option && option !== SAMPLE.answer ? "is-wrong" : "",
                      picked && picked !== option && option !== SAMPLE.answer ? "is-dim" : "",
                    ].join(" ")}
                  >
                    {option}
                  </button>
                </span>
              ))}{" "}
              {SAMPLE.after}
            </p>
            {picked ? (
              <div className="lp-try-foot">
                <p className={isRight ? "lp-fb lp-fb-right" : "lp-fb lp-fb-wrong"}>{isRight ? t.right : t.wrong}</p>
                <div className="lp-try-actions">
                  <Link href="/sign-in" className="lp-link">{t.more} →</Link>
                  <button type="button" className="lp-link lp-link-muted" onClick={() => setPicked(null)}>{t.again}</button>
                </div>
              </div>
            ) : (
              <p className="lp-try-hint">{t.pick}</p>
            )}
          </div>
        </section>

        {/* The logo is an open book resting on a solid bar — the page is built
            the same way: the hero above, the level ladder as the bar beneath. */}
        <section id="levels" className="lp-bar">
          <div className="lp-wrap">
            <h2 className="lp-bar-title">{t.levelsTitle}</h2>
            <ol className="lp-ladder">
              {LEVELS.map((level, index) => (
                <li key={level}>
                  <span className="lp-mono">{t.levelStep(index + 1)}</span>
                  <strong>{level}</strong>
                  <span className="lp-ladder-sub">Mid-course · End-course</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="how" className="lp-how lp-wrap">
          <div>
            <h2 className="lp-h2">{t.howTitle}</h2>
            <ol className="lp-steps">
              {t.steps.map(([title, text], index) => (
                <li key={title}>
                  <span className="lp-step-n">{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="lp-h2">{t.skillsTitle}</h2>
            <ul className="lp-skills">
              {SKILLS.map((skill) => (
                <li key={skill}>
                  <strong>{skill}</strong>
                  <span>{t.skills[skill]}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-end lp-wrap">
          <img className="lp-end-mark" src="/brand/registon-icon.webp" alt="" width={2000} height={2000} />
          <h2>{t.ctaTitle}</h2>
          <Link className="lp-btn lp-btn-solid lp-btn-lg" href="/sign-in">{t.start} <span aria-hidden="true">→</span></Link>
        </section>
      </main>

      <footer className="lp-foot lp-wrap">
        <span>© {new Date().getFullYear()} {t.footer}</span>
        <a href="https://rgn.uz/">{t.site}</a>
      </footer>
    </div>
  );
}
