import Image from "next/image";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import "../landing.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="landing-root relative min-h-screen overflow-hidden bg-[#0b0a08]">
      <div className="grain" aria-hidden="true" />
      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-10"><Logo /><ThemeToggle /></header>
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] max-w-6xl items-center gap-16 px-5 pb-12 lg:grid-cols-[1fr_460px]">
        <section className="relative hidden lg:block">
          <Image
            src="/brand/logo-symbol.png"
            alt=""
            width={520}
            height={520}
            aria-hidden
            className="pointer-events-none absolute -right-20 top-1/2 -z-10 h-[420px] w-[420px] -translate-y-1/2 opacity-[.07]"
          />
          <p className="eyebrow"><span /> REGISTON O&apos;QUV MARKAZI</p>
          <h1 className="mt-5 max-w-xl font-serif text-6xl font-semibold leading-[1.02] tracking-tight text-[#f5f1e8]">
            O&apos;rganing aniq.
            <br />
            <em className="not-italic text-[#f26522]">O&apos;sing ishonch bilan.</em>
          </h1>
          <p className="mt-6 max-w-lg text-[17px] leading-8 text-[#a79b86]">
            Bilim darajangizni ko&apos;rsatadigan, o&apos;sishingizni nishonlaydigan va keyingi qadamni aniq
            ko&apos;rsatadigan tuzilgan ingliz tili imtihonlari.
          </p>
          <div className="trust-row mt-10">
            <div className="trust-item">
              <span className="trust-icon">◈</span>
              <div><b>Aniq</b><small>imtihonlar</small></div>
            </div>
            <i />
            <div className="trust-item">
              <span className="trust-icon">◷</span>
              <div><b>Tezkor</b><small>natijalar</small></div>
            </div>
            <i />
            <div className="trust-item">
              <span className="trust-icon">▥</span>
              <div><b>Real</b><small>o&apos;sish</small></div>
            </div>
          </div>
        </section>
        {children}
      </div>
    </main>
  );
}
