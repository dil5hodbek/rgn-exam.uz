"use client";

import Link from "next/link";
import Image from "next/image";
import { LogIn, Award, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, Clock3, GraduationCap, Headphones, Layers3, PenLine, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./landing.css";
import { BrandImage } from "@/components/brand-image";
import { LevelIcon } from "@/components/dashboard/level-icon";
import { levelVisuals } from "@/lib/levels";
import { useLang, type Lang } from "@/lib/i18n";

const LEVELS = ["Beginner", "Elementary", "Pre-Intermediate", "Intermediate"];
const stepIcons = [LogIn, Layers3, PenLine, Award];
const SKILLS = ["Listening", "Reading", "Grammar", "Vocabulary", "Writing"] as const;

const SAMPLES = [
  { before: "If I were you, I", after: "more for the exam.", options: ["will study", "would study"], answer: "would study", explanation: { uz: '“If I were you” dan keyin would + fe’l keladi.', en: 'After “If I were you”, we use would + verb.' } },
  { before: "She", after: "English every day.", options: ["studies", "study"], answer: "studies", explanation: { uz: 'Present Simple zamonida she bilan studies ishlatiladi.', en: 'In the present simple, we use studies with she.' } },
  { before: "We have lived here", after: "2020.", options: ["for", "since"], answer: "since", explanation: { uz: 'Boshlanish vaqtini ko‘rsatish uchun since ishlatiladi.', en: 'Use since to describe the starting point in time.' } },
  { before: "This book is", after: "than that one.", options: ["more interesting", "most interesting"], answer: "more interesting", explanation: { uz: 'Ikki narsani solishtirishda more interesting ishlatiladi.', en: 'Use more interesting when comparing two things.' } },
  { before: "When I arrived, they", after: "dinner.", options: ["were having", "are having"], answer: "were having", explanation: { uz: 'O‘tmishda davom etayotgan harakat uchun Past Continuous ishlatiladi.', en: 'Use the past continuous for an action in progress in the past.' } },
];

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
    note: "Telegram orqali bir zumda kiring. Javoblaringiz avtomatik saqlanadi.",
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
      ["Testni yeching", "Vaqtni kuzatib, topshiriqlarni bajaring. Javoblaringiz avtomatik saqlanadi."],
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
    note: "Sign in instantly with Telegram. Your answers save automatically.",
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
      ["Take the test", "Follow the timer and complete the exercises. Your answers save as you go."],
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

const visuals = {
  uz: {
    title: "Bilimingizni", accent: "keyingi bosqichga.", sub: "Siz tayyorsiz. Endi buni ko‘rsating.",
    intro: "O‘rganganlaringizni sinang, kuchli tomonlaringizni kashf eting va keyingi maqsadingiz sari qadam qo‘ying.",
    preview: "Kichik sinov. Katta boshlanish.", sample: "INTERAKTIV NAMUNA", workspace: "Sizning imtihon maydoningiz",
    ready: "Bilimingizni sinashga tayyormisiz?", saved: "Javoblar avtomatik saqlanadi", question: "1-savol", progress: "Sinab ko‘ring", completed: "Savol yakunlandi",
    correct: "Ajoyib! To‘g‘ri javob.", retry: "Har bir xato — yangi bilim.", sampleOnly: "Bu faqat namuna. Natija hisobingizga yozilmaydi.",
    levelsLabel: "O‘Z YO‘LINGIZNI TANLANG", levelsSub: "Birinchi qadamlardan ishonchli ingliz tiligacha. Sizga mos darajadan boshlang.",
    explore: "Boshlash", exams: "2 turdagi imtihon", allSkills: "Bitta imtihon. Besh ko‘nikma.", skillsLabel: "HAR TOMONLAMA RIVOJLANING",
    howLabel: "HAMMASI ODDIY", howSub: "Bir necha qadam — va siz imtihondasiz.",
    ctaLabel: "KEYINGI QADAM — SIZDAN", ctaSub: "Hisobingizga kiring. Darajangizni tanlang. O‘z imkoniyatingizni ko‘rsating.",
    levelCount: "daraja", skillCount: "ko‘nikma", examCount: "imtihon turi", journey: "Sizning o‘sish yo‘lingiz", yourTurn: "Endi sizning navbatingiz!",
  },
  en: {
    title: "Take your English", accent: "to the next level.", sub: "You’re ready. Now show it.",
    intro: "Put your learning into practice, discover your strengths and take a confident step toward your next goal.",
    preview: "A small challenge. A great start.", sample: "INTERACTIVE SAMPLE", workspace: "Your exam workspace",
    ready: "Ready to put your knowledge to the test?", saved: "Answers save automatically", question: "Question 1", progress: "Give it a go", completed: "Question complete",
    correct: "Great work! That’s correct.", retry: "Every mistake is a chance to learn.", sampleOnly: "This is a sample. It won’t affect your account.",
    levelsLabel: "FIND YOUR STARTING POINT", levelsSub: "From your first steps to confident English. Start at the level that fits you.",
    explore: "Get started", exams: "2 exam types", allSkills: "One exam. Five skills.", skillsLabel: "BUILD THE COMPLETE PICTURE",
    howLabel: "KEEP IT SIMPLE", howSub: "A few easy steps, and you’re ready to begin.",
    ctaLabel: "YOUR NEXT STEP STARTS HERE", ctaSub: "Sign in. Choose your level. Show what you can do.",
    levelCount: "levels", skillCount: "skills", examCount: "exam types", journey: "Your learning journey", yourTurn: "Now it’s your turn!",
  },
};
const levelSlugs = ["beginner", "elementary", "pre-intermediate", "intermediate"];
const skillIcons = { Listening: Headphones, Reading: BookOpen, Grammar: Layers3, Vocabulary: Sparkles, Writing: PenLine };

function BookArtwork() {
  return <div className="lp-book-art" aria-hidden="true">
    <Image className="lp-book-image" src="/illustrations/hero-book-3d.png" width={1536} height={1024} sizes="(max-width: 600px) 230px, 260px" alt="" priority />

  </div>;
}

export default function Home() {
  const { lang, setLang } = useLang();
  const [picked, setPicked] = useState<string | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const sample = SAMPLES[sampleIndex];
  const sampleProgress = sampleIndex + (picked ? 1 : 0);
  const t = dict[lang];
  const v = visuals[lang];
  const [skillPosition, setSkillPosition] = useState(1);
  const [skillResetting, setSkillResetting] = useState(false);
  const skillIndex = (skillPosition - 1 + SKILLS.length) % SKILLS.length;
  function settleSkillLoop() {
    if (skillPosition !== 0 && skillPosition !== SKILLS.length + 1) return;
    setSkillResetting(true);
    setSkillPosition(skillPosition === 0 ? SKILLS.length : 1);
  }
  useEffect(() => {
    if (!skillResetting) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setSkillResetting(false));
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [skillResetting]);
  useEffect(() => {
    if (skillPosition !== 0 && skillPosition !== SKILLS.length + 1) return;
    // Fallback for hidden tabs or browsers that omit transitionend.
    const timer = window.setTimeout(() => {
      setSkillResetting(true);
      setSkillPosition(skillPosition === 0 ? SKILLS.length : 1);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [skillPosition]);
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const [carouselVisible, setCarouselVisible] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const stepsRef = useRef<HTMLOListElement>(null);
  const [stepsVisible, setStepsVisible] = useState(false);
  const [stepFrame, setStepFrame] = useState({ active: 0, source: -1, progress: 0 });
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    function start() {
      cancelAnimationFrame(frame);
      setStepFrame({ active: 0, source: -1, progress: 0 });
      if (!stepsVisible || pageHidden || motion.matches) return;
      const startedAt = performance.now();
      let previousTick = -1;
      const tick = (now: number) => {
        const elapsed = (now - startedAt) % 12000;
        const index = Math.floor(elapsed / 3000);
        const localTime = elapsed % 3000;
        const moving = index < 3 && localTime >= 900;
        const tickIndex = Math.floor(elapsed / 33);
        if (tickIndex !== previousTick) {
          previousTick = tickIndex;
          setStepFrame({ active: moving ? -1 : index, source: moving ? index : -1, progress: moving ? (localTime - 900) / 2100 : 0 });
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    start();
    motion.addEventListener("change", start);
    return () => { cancelAnimationFrame(frame); motion.removeEventListener("change", start); };
  }, [stepsVisible, pageHidden]);
  useEffect(() => {
    const element = stepsRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setStepsVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const carouselRef = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const rotating = rotationEnabled && carouselVisible && !pageHidden && !dragging;
  useEffect(() => {
    const element = carouselRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setCarouselVisible(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const respectMotion = () => setRotationEnabled(!motion.matches);
    respectMotion();
    motion.addEventListener("change", respectMotion);
    const visibility = () => setPageHidden(document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { motion.removeEventListener("change", respectMotion); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!rotating || skillResetting || skillPosition === 0 || skillPosition === SKILLS.length + 1) return;
    const timer = window.setTimeout(() => setSkillPosition(position => position + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [rotating, skillPosition, skillResetting]);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
      setShowBackToTop(window.scrollY > window.innerHeight * 0.6);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  function selectSkill(index: number) {
    if (skillResetting || skillPosition === 0 || skillPosition === SKILLS.length + 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSkillPosition((index + SKILLS.length) % SKILLS.length + 1);
    } else {
      setSkillPosition(index + 1);
    }
  }
  function backToTop() {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  const isRight = picked === sample.answer;

  function toggleLang() {
    setLang(lang === "uz" ? "en" : "uz");
  }

  return (
    <div className="landing-root" lang={lang}>
      <div className="lp-reading-progress" aria-hidden="true"><span style={{ transform: `scaleX(${scrollProgress})` }} /></div>
      <header className="lp-nav lp-wrap">
        <Link href="/" className="lp-brand" aria-label="Registon">
          <BrandImage />
        </Link>
        <nav className="lp-links" aria-label={lang === "uz" ? "Sahifa" : "Page navigation"}>
          <a href="#levels">{t.navLevels}</a><a href="#how">{t.navHow}</a>
        </nav>
        <div className="lp-actions">
          <button type="button" className="lp-lang" onClick={toggleLang} aria-label={lang === "uz" ? "Switch to English" : "O'zbek tiliga o'tish"}>{lang === "uz" ? "EN" : "UZ"}</button>
          <ThemeToggle />
          <Link className="lp-btn lp-btn-quiet" href="/sign-in">{t.signIn}</Link>
          <Link className="lp-btn lp-btn-solid lp-hide-sm" href="/create-account">{t.signUp}<ArrowUpRight size={16} /></Link>
        </div>
      </header>
      <main>
        <div className="lp-hero-zone">
          <section className="lp-hero lp-wrap">
            <div className="lp-hero-copy">
              <p className="lp-overline">{v.sub}</p>
              <h1>{v.title}<br /><span className="lp-title-accent">{v.accent}<svg viewBox="0 0 420 18" preserveAspectRatio="none" aria-hidden="true"><path d="M3 12Q180-5 417 10" /></svg></span></h1>
              <p className="lp-lead">{v.intro}</p>
              <div className="lp-cta-row">
                <Link className="lp-btn lp-btn-solid lp-btn-lg" href="/sign-in">{t.start}<ArrowUpRight size={20} /></Link>
                <a className="lp-btn lp-btn-line lp-btn-lg" href="#try-question">{t.tryLabel}<ArrowRight size={18} /></a>
              </div>
            </div>
            <div className="lp-stage" id="try-question">
              <div className="lp-orbit lp-orbit-one" aria-hidden="true" /><div className="lp-orbit lp-orbit-two" aria-hidden="true" />
              <a className="lp-floating lp-floating-top lp-sample-invite" href="#try-question"><span className="lp-invite-mark" aria-hidden="true"><span>5</span><BookOpen size={15}/></span><div><span className="lp-invite-label">{lang === "uz" ? "BEPUL KICHIK SINOV" : "FREE MINI CHALLENGE"}</span><strong>{lang === "uz" ? "5 ta savolni sinab ko‘ring" : "Give 5 questions a try"}</strong><span className="lp-invite-action">{lang === "uz" ? "Boshlash" : "Start now"}<ArrowRight size={12}/></span></div></a>
              <BookArtwork />
              <div className="lp-exam-window">
                <div className="lp-window-bar"><div className="lp-window-dots" aria-hidden="true"><i /><i /><i /></div><span>{v.workspace}</span><ShieldCheck size={14} /></div>
                <div className="lp-try">
                  <div className="lp-try-head"><span className="lp-sample-label"><Sparkles size={13} />{v.sample}</span><span className="lp-timer"><Clock3 size={14} />50:00</span></div>
                  <div className="lp-question-meta"><span>{lang === "uz" ? "Savol" : "Question"} {sampleIndex + 1} / {SAMPLES.length}</span><span>Grammar</span></div>
                  <p className="lp-try-q">{sample.before} <span className="lp-answer-blank">{picked || "…"}</span> {sample.after}</p>
                  <div className="lp-options">{sample.options.map((option, index) => <button key={option} type="button" disabled={!!picked} onClick={() => setPicked(option)} className={["lp-opt", picked && option === sample.answer ? "is-right" : "", picked === option && option !== sample.answer ? "is-wrong" : "", picked && picked !== option && option !== sample.answer ? "is-dim" : ""].join(" ")}><span className="lp-option-letter">{picked && option === sample.answer ? <Check size={16} /> : String.fromCharCode(65 + index)}</span>{option}<span className="lp-option-radio" aria-hidden="true" /></button>)}</div>
                  <div aria-live="polite" aria-atomic="true">
                    {picked ? <div className="lp-try-foot"><p className={isRight ? "lp-fb lp-fb-right" : "lp-fb lp-fb-wrong"}>{isRight ? v.correct : v.retry} {sample.explanation[lang]}</p><button type="button" className="lp-link" onClick={() => { setPicked(null); setSampleIndex(index => (index + 1) % SAMPLES.length); }}>{sampleIndex === SAMPLES.length - 1 ? t.again : lang === "uz" ? "Keyingi savol" : "Next question"}<ArrowRight size={14} /></button></div> : <p className="lp-try-hint">{t.pick}</p>}
                  </div>
                  <div className="lp-demo-progress"><div><span>{sampleProgress === SAMPLES.length ? v.completed : v.progress}</span><strong>{sampleProgress} / {SAMPLES.length}</strong></div><span className={sampleProgress === SAMPLES.length ? "is-complete" : ""}><i style={{ width: `${sampleProgress / SAMPLES.length * 100}%` }} /></span></div>
                </div>
              </div>
              <div className="lp-floating lp-floating-bottom"><span className="lp-save-check"><CheckCircle2 size={20} /></span><span>{v.saved}</span></div>
              <p className="lp-sample-note">{v.sampleOnly}</p>
            </div>
          </section>
          <div className="lp-scroll-cue"><a href="#levels"><span>{lang === "uz" ? "Pastga suring · Darajalarni kashf eting" : "Scroll down · Find your level"}</span><ChevronDown size={19} /></a></div>
          <div className="lp-skill-ribbon" aria-hidden="true"><div>{SKILLS.map((skill) => {const Icon = skillIcons[skill]; return <span key={skill}><Icon size={19} />{skill}</span>;})}</div></div>
        </div>
        <section id="levels" className="lp-level-section lp-wrap">
          <div className="lp-section-heading"><div><p className="lp-kicker">{v.levelsLabel}</p><h2 className="lp-h2">{t.levelsTitle}</h2></div><p>{v.levelsSub}</p></div>
          <div className="lp-level-cards">{LEVELS.map((level, index) => {return <Link href="/sign-in" className={`lp-level-card lp-level-${index}`} key={level}>
            <div className="lp-level-top"><span className="lp-level-number">0{index + 1}</span><ArrowUpRight size={19} /></div>
            <div className="lp-level-art"><LevelIcon level={levelVisuals[levelSlugs[index]]} /></div>
            <span className="lp-level-label">{t.levelStep(index + 1)}</span><h3>{level}</h3><p>Mid-course · End-course</p>
            <div className="lp-level-bars" aria-hidden="true">{[0,1,2,3].map(i => <i key={i} className={i <= index ? "active" : ""} />)}</div>
            <div className="lp-level-bottom"><span>{v.exams}</span><strong>{v.explore}<ArrowRight size={15} /></strong></div>
          </Link>;})}</div>
        </section>
        <section className="lp-skills-section">
          <div className="lp-skills-inner lp-wrap">
            <div className="lp-skills-copy"><p className="lp-kicker">{v.skillsLabel}</p><h2 className="lp-h2">{v.allSkills}</h2><p>{t.lead}</p></div>
            <div className="lp-carousel" ref={carouselRef} role="region" aria-roledescription="carousel" aria-label={t.skillsTitle}>
              <div className="lp-carousel-stage">
              <button type="button" className="lp-carousel-arrow lp-carousel-prev" onClick={() => selectSkill(skillIndex - 1)} aria-label={lang === "uz" ? "Oldingi ko‘nikma" : "Previous skill"}><ChevronLeft size={20}/></button>
              <div className="lp-skill-display">
                <div className="lp-carousel-viewport" tabIndex={0} aria-label={lang === "uz" ? "Ko‘nikmalar: chap yoki o‘ngga suring" : "Skills: swipe left or right"} aria-live={rotating ? "off" : "polite"}
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    selectSkill(event.key === "Home" ? 0 : event.key === "End" ? SKILLS.length - 1 : skillIndex + (event.key === "ArrowRight" ? 1 : -1));
                  }}
                  onPointerDown={(event) => {
                    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
                    swipeStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                    setDragging(true);
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const start = swipeStart.current;
                    if (!start || start.id !== event.pointerId) return;
                    const dx = event.clientX - start.x;
                    if (Math.abs(dx) > Math.abs(event.clientY - start.y)) setDragOffset(Math.max(-90, Math.min(90, dx)));
                  }}
                  onPointerUp={(event) => {
                    const start = swipeStart.current;
                    swipeStart.current = null;
                    setDragging(false); setDragOffset(0);
                    if (!start || start.id !== event.pointerId) return;
                    const dx = event.clientX - start.x;
                    if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(event.clientY - start.y)) selectSkill(skillIndex + (dx < 0 ? 1 : -1));
                  }}
                  onPointerCancel={() => { swipeStart.current = null; setDragging(false); setDragOffset(0); }}>
                  <div className={`lp-carousel-track${dragging || skillResetting ? " is-dragging" : ""}`} onTransitionEnd={(event) => { if (event.target === event.currentTarget && event.propertyName === "transform") settleSkillLoop(); }} style={{ transform: `translate3d(calc(-${skillPosition * 100}% + ${dragOffset}px), 0, 0)` }}>
                    {[SKILLS[SKILLS.length - 1], ...SKILLS, SKILLS[0]].map((skill, position) => { const index = (position - 1 + SKILLS.length) % SKILLS.length; const Icon = skillIcons[skill]; return <div className="lp-carousel-slide" key={`${skill}-${position}`} role="group" aria-roledescription="slide" aria-label={`${index + 1} / 5 · ${skill}`} aria-hidden={position === 0 || position === SKILLS.length + 1 || index !== skillIndex}>
                      <div className={`lp-skill-graphic lp-graphic-${skill.toLowerCase()}`} aria-hidden="true"><span className="lp-graphic-circle"/><Icon size={74} strokeWidth={1.2}/>{skill === "Listening" ? <div className="lp-waveform">{[18,30,48,24,60,42,72,40,58,28,46,22,34].map((height,i)=><i key={i} style={{height,animationDelay:`${i*70}ms`}}/>)}</div> : skill === "Writing" ? <div className="lp-writing-lines"><i/><i/><i/><span>Wonderful progress.</span></div> : <div className="lp-word-tiles">{(skill === "Vocabulary" ? ["discover","grow","achieve"] : skill === "Grammar" ? ["learn","learned","learning"] : ["Read.","Understand.","Explore."]).map(word=><span key={word}>{word}</span>)}</div>}</div>
                      <div className="lp-skill-display-bottom"><div><span>0{index+1} / 05</span><h3>{skill}</h3><p>{t.skills[skill]}</p></div><span className="lp-skill-round"><Icon size={22}/></span></div>
                    </div>; })}
                  </div>
                </div>
              </div>
              <button type="button" className="lp-carousel-arrow lp-carousel-next" onClick={() => selectSkill(skillIndex + 1)} aria-label={lang === "uz" ? "Keyingi ko‘nikma" : "Next skill"}><ChevronRight size={20}/></button>
              </div>
              <div className="lp-carousel-controls">
                <div className="lp-carousel-dots">{SKILLS.map((skill,index)=><button type="button" key={skill} className={index===skillIndex?"is-active":""} aria-label={`${lang === "uz" ? "Ko‘nikma" : "Skill"} ${index+1}: ${skill}`} aria-current={index===skillIndex?"true":undefined} onClick={()=>selectSkill(index)}><span/></button>)}</div>
              </div>
            </div>
          </div>
        </section>
        <section id="how" className="lp-how lp-wrap"><div className="lp-how-heading"><p className="lp-kicker">{v.howLabel}</p><h2 className="lp-h2">{t.howTitle}</h2><p>{v.howSub}</p></div><ol ref={stepsRef} className={`lp-steps${stepsVisible && !pageHidden ? " is-visible" : ""}`}>{t.steps.map(([title,text],index)=>{const Icon = stepIcons[index]; return <li key={title}><span className={`lp-step-visual${stepFrame.active === index ? " is-active" : ""}`} aria-hidden="true"><Icon size={28} strokeWidth={1.6} /></span><h3>{title}</h3><p>{text}</p>{index<3&&<span className="lp-step-cable" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path className="lp-cable-horizontal lp-cable-base" d="M0 50 H100" /><path className="lp-cable-vertical lp-cable-base" d="M50 0 V100" /></svg><span className={`lp-cable-pulse${stepFrame.source === index ? " is-moving" : ""}`} style={{ "--pulse-position": `${stepFrame.progress * 100}%` } as CSSProperties} /></span>}</li>;})}</ol></section>
        <section className="lp-end-wrap lp-wrap"><div className="lp-end"><div className="lp-end-copy"><p className="lp-kicker">{v.ctaLabel}</p><h2>{t.ctaTitle}</h2><p>{v.ctaSub}</p><Link className="lp-btn lp-btn-solid lp-btn-lg" href="/create-account">{t.create}<ArrowUpRight size={20}/></Link></div><div className="lp-end-art" aria-hidden="true"><div className="lp-pass-outline"/><div className="lp-exam-pass"><div className="lp-pass-header"><span>REGISTON</span><ArrowUpRight size={18}/></div><div className="lp-pass-emblem"><GraduationCap size={48} strokeWidth={1.6}/></div><strong>{lang === "uz" ? "Yangi bosqichga tayyor." : "Ready for your next level."}</strong><div className="lp-pass-path"><span/><span/><span/><span><Check size={15}/></span></div><div className="lp-pass-footer"><span><Headphones size={17}/><BookOpen size={17}/><PenLine size={17}/></span><ArrowRight size={20}/></div></div></div></div></section>
      </main>
      {showBackToTop && <button type="button" className="lp-back-top" onClick={backToTop} aria-label={lang === "uz" ? "Sahifa boshiga qaytish" : "Back to top"}><ArrowUp size={19}/><span>{lang === "uz" ? "Yuqoriga" : "Top"}</span></button>}
      <footer className="lp-foot lp-wrap"><Link href="/" className="lp-brand"><BrandImage /></Link><span>© {new Date().getFullYear()} {t.footer}</span><a href="https://rgn.uz/">{t.site}<ArrowUpRight size={14}/></a></footer>
    </div>
  );
}
