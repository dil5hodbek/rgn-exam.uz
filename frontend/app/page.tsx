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

    const sections = [...document.querySelectorAll(".landing-root main section[id]")];
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        document.querySelectorAll(".landing-root .chapter").forEach((item) => item.classList.remove("active"));
        document.querySelector(`.landing-root .chapter[href="#${visible.target.id}"]`)?.classList.add("active");
      },
      { rootMargin: "-25% 0px -60% 0px", threshold: [0, 0.2, 0.5] },
    );
    sections.forEach((s) => sectionObserver.observe(s));

    return () => {
      observer.disconnect();
      sectionObserver.disconnect();
    };
  }, [checked]);

  if (!checked) return null;

  return (
    <div className="landing-root">
      <div className="grain" aria-hidden="true" />
      <aside className="chapter-rail" aria-label="Sahifa bo'limlari">
        <div className="rail-line" />
        <a className="chapter active" href="#hero">
          <span className="chapter-icon">▱</span>
          <strong>01. Hero</strong>
          <small>Asosiy g'oya</small>
        </a>
        <a className="chapter" href="#levels">
          <span className="chapter-icon">⌁</span>
          <strong>02. Darajalar</strong>
          <small>Qanday daraja sizga mos?</small>
        </a>
        <a className="chapter" href="#why">
          <span className="chapter-icon">◇</span>
          <strong>03. Nega Registon?</strong>
          <small>Platforma afzalliklari</small>
        </a>
        <a className="chapter" href="#how">
          <span className="chapter-icon">✓</span>
          <strong>04. Qanday ishlaydi?</strong>
          <small>4 oddiy qadam</small>
        </a>
      </aside>
      <main>
        <section id="hero" className="hero section">
          <nav className="nav container">
            <Link href="/" className="brand">
              <img src="/brand/logo-orange.png" alt="Registon O'quv Markazi" />
            </Link>
            <div className="nav-links">
              <a className="active" href="#hero">Imtihon</a>
              <a href="#levels">Darajalar</a>
              <a href="#why">Nega biz?</a>
              <a href="#how">Qanday?</a>
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
                RGN Exam — ingliz tilini baholash, o'z darajangizni aniqlash va keyingi bosqichga tayyorgarlik
                ko'rish uchun onlayn imtihon platformasi.
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

        <section id="levels" className="section content-section">
          <div className="container split-section reveal">
            <div className="section-intro">
              <p className="chapter-label">I bob</p>
              <h2>Barcha darajalar<br />uchun</h2>
              <p>A1 dan B1 gacha bo'lgan darajalar uchun moslashtirilgan imtihonlar. O'z darajangizni aniqlang va keyingi bosqichga chiqing.</p>
              <Link className="text-link" href="/sign-in">Darajalar haqida <span>→</span></Link>
            </div>
            <div className="level-grid">
              <article className="level-card">
                <span className="level-dot dot-a1" />
                <strong>A1</strong>
                <h3>Beginner</h3>
                <p>Oddiy kundalik mavzular haqida gapira olish.</p>
              </article>
              <article className="level-card">
                <span className="level-dot dot-a2" />
                <strong>A2</strong>
                <h3>Elementary</h3>
                <p>Oddiy suhbatda o'z fikringizni tobora erkin ifoda etish.</p>
              </article>
              <article className="level-card">
                <span className="level-dot dot-b1" />
                <strong>B1</strong>
                <h3>Intermediate</h3>
                <p>Murakkab mavzular bo'yicha aniq va ravon muloqot.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="why" className="section why-section">
          <div className="why-image">
            <img src="/brand/student-01.jpg" alt="Onlayn ta'lim olayotgan talaba" />
            <div />
          </div>
          <div className="container reveal why-inner">
            <div className="section-intro wide">
              <p className="chapter-label">II bob</p>
              <h2>Nega Registon?</h2>
              <p>Bizning platformamiz sizga nafaqat imtihon, balki haqiqiy natijani beradi.</p>
            </div>
            <div className="feature-grid">
              <article className="feature">
                <span>♢</span>
                <h3>Tajriba va sifat</h3>
                <p>Yillar davomida minglab talabalar ishonchini qozongan markaz.</p>
              </article>
              <article className="feature">
                <span>▱</span>
                <h3>Zamonaviy texnologiya</h3>
                <p>Onlayn platforma, istalgan vaqtda, istalgan joyda.</p>
              </article>
              <article className="feature">
                <span>◎</span>
                <h3>Aniq baholash</h3>
                <p>Standartlarga mos testlar va batafsil natijalar.</p>
              </article>
              <article className="feature">
                <span>♧</span>
                <h3>Professional o'qituvchilar</h3>
                <p>Sizning rivojlanishingiz uchun doim yoningizda.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="how" className="section how-section">
          <div className="container reveal">
            <p className="chapter-label">III bob</p>
            <h2>Qanday ishlaydi?</h2>
            <p className="section-lead">Oddiy 4 qadam — va siz imtihonga tayyorsiz.</p>
            <div className="steps">
              <article className="step">
                <span>1</span>
                <div><h3>Ro'yxatdan o'ting</h3><p>Qisqa forma orqali hisob qaydnomangizni yarating.</p></div>
              </article>
              <div className="step-arrow">→</div>
              <article className="step">
                <span>2</span>
                <div><h3>Darajangizni tanlang</h3><p>A1–B1 oralig'ida mos darajani belgilang.</p></div>
              </article>
              <div className="step-arrow">→</div>
              <article className="step">
                <span>3</span>
                <div><h3>Imtihonni topshiring</h3><p>Onlayn platformada testni yeching.</p></div>
              </article>
              <div className="step-arrow">→</div>
              <article className="step">
                <span>4</span>
                <div><h3>Natijani oling</h3><p>Darhol natijani ko'ring va keyingi qadamingizni rejalashtiring.</p></div>
              </article>
            </div>
          </div>
        </section>

        <section id="signup" className="cta section">
          <div className="cta-bg" />
          <div className="container cta-inner reveal">
            <div className="cta-note">
              Your English<br />Journey Starts Here
              <span className="stroke" />
            </div>
            <div>
              <p className="chapter-label">IV bob</p>
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
