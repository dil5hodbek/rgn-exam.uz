import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--text-primary)",
        muted: "var(--text-secondary)",
        canvas: "var(--bg-primary)",
        surface: "var(--bg-secondary)",
        line: "var(--border)",
        brand: "var(--accent)",
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        soft: "0 12px 40px rgba(31, 37, 51, .08)",
        lift: "0 18px 50px rgba(79, 70, 229, .16)",
      },
    },
  },
  plugins: [],
};
export default config;
