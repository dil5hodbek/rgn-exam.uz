"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import "./landing.css";

type Lang = "en" | "uz";

const dict = {
  en: {
    eyebrow: "REGISTON LEARNING CENTER",
    navImtihon: "Exam",
    navWhy: "Why us?",
    navHow: "How it works?",
    signIn: "Sign In",
    signUp: "Sign Up",
    h1a: "Test your",
    h1b: "English",
    h1c: "with confidence",
    desc: "Registon Learning Center's online exam platform — assess your English, track your progress, and prepare for the next step.",
    start: "Start",
    trust1: "Reliable",
    trust1s: "platform",
    trust2: "Fast & easy",
    trust2s: "exams",
    trust3: "Results",
    trust3s: "& analysis",
    handNote: ["Better", "English", "Brighter", "Future"],
    ctaNote: ["Your English", "Journey Starts Here"],
    ctaH2a: "Test yourself",
    ctaH2b: "today!",
    ctaDesc: "Open new opportunities in English with Registon.",
    signUpArrow: "Sign Up",
    footer: "Registon Learning Center",
  },
  uz: {
    eyebrow: "REGISTON O'QUV MARKAZI",
    navImtihon: "Imtihon",
    navWhy: "Nega biz?",
    navHow: "Qanday?",
    signIn: "Kirish",
    signUp: "Ro'yxatdan o'tish",
    h1a: "Ingliz tili",
    h1b: "bilimingizni",
    h1c: "sinab ko'ring",
    desc: "Registon O'quv Markazi onlayn imtihon platformasi — ingliz tilini baholash, rivojlantirish va keyingi bosqichga tayyorgarlik ko'rish uchun.",
    start: "Boshlash",
    trust1: "Ishonchli",
    trust1s: "platforma",
    trust2: "Tez va qulay",
    trust2s: "imtihon",
    trust3: "Natijalar",
    trust3s: "va tahlil",
    handNote: ["Better", "English", "Brighter", "Future"],
    ctaNote: ["Your English", "Journey Starts Here"],
    ctaH2a: "Bugun o'zingizni",
    ctaH2b: "sinab ko'ring!",
    ctaDesc: "Registon bilan ingliz tilida yangi imkoniyatlarga ochiling.",
    signUpArrow: "Ro'yxatdan o'tish",
    footer: "Registon O'quv Markazi",
  },
} satisfies Record<Lang, Record<string, string | string[]>>;

export default function Home() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
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
    const saved = window.localStorage.getItem("landing-lang");
    if (saved === "en" || saved === "uz") setLang(saved);
  }, []);

  useEffect(() => {
    if (!checked) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        });
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".landing-root .reveal").forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [checked]);

  if (!checked) return null;

  const t = dict[lang];
  function toggleLang() {
    const next = lang === "en" ? "uz" : "en";
    setLang(next);
    window.localStorage.setItem("landing-lang", next);
  }

  return (
    <div className="landing-root">
      <div className="grain" aria-hidden="true" />
      <main>
        <section id="hero" className="hero section">
          <nav className="nav container">
            <Link href="/" className="brand">
              <img src="/brand/logo-orange.png" alt="Registon O'quv Markazi" />
            </Link>
            <div className="nav-links">
              <a className="active" href="#hero">{t.navImtihon}</a>
              <a href="https://rgn.uz/biz-haqimizda/">{t.navWhy}</a>
              <a href="https://rgn.uz/">{t.navHow}</a>
            </div>
            <div className="nav-actions">
              <button type="button" className="btn btn-ghost btn-small lang-toggle" onClick={toggleLang} aria-label="Toggle language">
                {lang === "en" ? "UZ" : "EN"}
              </button>
              <Link className="btn btn-ghost btn-small" href="/sign-in">{t.signIn}</Link>
              <Link className="btn btn-primary btn-small" href="/sign-in">{t.signUp}</Link>
            </div>
            <button className="menu-toggle" aria-label="Menyu" aria-expanded="false">
              <span /><span />
            </button>
          </nav>
          <div className="hero-content container">
            <div className="hero-copy reveal">
              <p className="eyebrow"><span /> {t.eyebrow}</p>
              <h1>
                {t.h1a}
                <br />
                {t.h1b}
                <br />
                <em>{t.h1c}</em>
              </h1>
              <p className="hero-description">{t.desc}</p>
              <div className="hero-buttons">
                <Link className="btn btn-primary" href="/sign-in">{t.start} <span>→</span></Link>
                <Link className="btn btn-outline" href="/sign-in">{t.signIn}</Link>
              </div>
              <div className="trust-row">
                <div className="trust-item">
                  <span className="trust-icon">◈</span>
                  <div><b>{t.trust1}</b><small>{t.trust1s}</small></div>
                </div>
                <i />
                <div className="trust-item">
                  <span className="trust-icon">◷</span>
                  <div><b>{t.trust2}</b><small>{t.trust2s}</small></div>
                </div>
                <i />
                <div className="trust-item">
                  <span className="trust-icon">▥</span>
                  <div><b>{t.trust3}</b><small>{t.trust3s}</small></div>
                </div>
              </div>
            </div>
            <div className="hero-visual reveal reveal-delay">
              <div className="image-frame">
                <img className="student-photo" src="/brand/student-02.png" alt="Ingliz tili ustida ishlayotgan talaba" />
                <div className="image-shade" />
              </div>
              <img className="symbol-mark" src="/brand/logo-symbol.png" alt="" />
              <div className="hand-note">
                {t.handNote[0]}<br />{t.handNote[1]}<br />{t.handNote[2]}<br />{t.handNote[3]}
                <span className="stroke" />
              </div>
              <div className="orange-stroke" />
            </div>
          </div>
          <div className="hero-bottom-line container" />
        </section>

        <section id="signup" className="cta section">
          <div className="cta-bg" />
          <div className="container cta-inner reveal">
            <div className="cta-note">
              {t.ctaNote[0]}<br />{t.ctaNote[1]}
              <span className="stroke" />
            </div>
            <div>
              <h2>{t.ctaH2a}<br /><em>{t.ctaH2b}</em></h2>
              <p>{t.ctaDesc}</p>
              <div className="cta-buttons">
                <Link className="btn btn-primary" href="/sign-in">{t.signUpArrow} <span>→</span></Link>
                <Link className="btn btn-outline" href="/sign-in">{t.signIn}</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="container">
          <span>© {new Date().getFullYear()} {t.footer}</span>
          <span>RGN Exam</span>
        </div>
      </footer>
    </div>
  );
}
