import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="noise relative min-h-screen overflow-hidden bg-surface">
      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-10"><Logo /><ThemeToggle /></header>
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] max-w-6xl items-center gap-16 px-5 pb-12 lg:grid-cols-[1fr_460px]">
        <section className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
            <span className="h-2 w-2 rounded-full bg-indigo-500" /> Purpose-built for progress
          </div>
          <h2 className="mt-7 max-w-xl text-6xl font-extrabold leading-[1.04] tracking-[-.045em] text-ink">Learn clearly.<br /><span className="text-brand">Grow confidently.</span></h2>
          <p className="mt-6 max-w-lg text-lg leading-8 text-muted">Structured English assessments that show where you are, celebrate how far you’ve come, and make the next step obvious.</p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {["Focused exams", "Instant insight", "Real progress"].map((item) => <div key={item} className="rounded-2xl border border-line bg-canvas/70 p-4 text-sm font-bold text-ink backdrop-blur"><span className="mb-3 block h-1.5 w-8 rounded-full bg-brand" />{item}</div>)}
          </div>
        </section>
        {children}
      </div>
      <div className="card-grid absolute -bottom-20 -left-20 h-80 w-80 rotate-12 opacity-30" />
    </main>
  );
}
