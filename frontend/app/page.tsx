"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import "./landing.css";

export default function Home() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
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
              <a className="active" href="#hero">Imtihon</a>
              <a href="https://rgn.uz/biz-haqimizda/">Nega biz?</a>
              <a href="https://rgn.uz/">Qanday?</a>
            </div>
            <div className="nav-actions">
              <Link className="btn btn-ghost btn-small" href="/sign-in">Kirish</Link>
              <Link className="btn btn-primary btn-small" href="/sign-in">Ro'yxatdan o'tish</Link>
            </div>
            <button className="menu-toggle" aria-label="Menyu" aria-expanded="false">
              <span /><span />
            </button>
          </nav>
          <div className="hero-content container">
            <div className="hero-copy reveal">
              <p className="eyebrow"><span /> REGISTON O'QUV MARKAZI</p>
              <h1>
                Ingliz tili
                <br />
                bilimingizni
                <br />
                <em>sinab ko'ring</em>
              </h1>
              <p className="hero-description">
                Registon O'quv Markazi onlayn imtihon platformasi — ingliz tilini baholash, rivojlantirish va
                keyingi bosqichga tayyorgarlik ko'rish uchun.
              </p>
              <div className="hero-buttons">
                <Link className="btn btn-primary" href="/sign-in">Boshlash <span>→</span></Link>
                <Link className="btn btn-outline" href="/sign-in">Kirish</Link>
              </div>
              <div className="trust-row">
                <div className="trust-item">
                  <span className="trust-icon">◈</span>
                  <div><b>Ishonchli</b><small>platforma</small></div>
                </div>
                <i />
                <div className="trust-item">
                  <span className="trust-icon">◷</span>
                  <div><b>Tez va qulay</b><small>imtihon</small></div>
                </div>
                <i />
                <div className="trust-item">
                  <span className="trust-icon">▥</span>
                  <div><b>Natijalar</b><small>va tahlil</small></div>
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
                Better<br />English<br />Brighter<br />Future
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
              Your English<br />Journey Starts Here
              <span className="stroke" />
            </div>
            <div>
              <h2>Bugun o'zingizni<br /><em>sinab ko'ring!</em></h2>
              <p>Registon bilan ingliz tilida yangi imkoniyatlarga ochiling.</p>
              <div className="cta-buttons">
                <Link className="btn btn-primary" href="/sign-in">Ro'yxatdan o'tish <span>→</span></Link>
                <Link className="btn btn-outline" href="/sign-in">Kirish</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="container">
          <span>© {new Date().getFullYear()} Registon O'quv Markazi</span>
          <span>RGN Exam</span>
        </div>
      </footer>
    </div>
  );
}
