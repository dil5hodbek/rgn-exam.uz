import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  darkMode: ["class"],
  // hover: styles only on devices that really hover (mouse/trackpad). On
  // phones a tapped answer used to keep its hover highlight and look picked.
  future: { hoverOnlyWhenSupported: true },
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
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
        sans: ["var(--font-body)"],
        display: ["var(--font-display)"],
        serif: ["Georgia", "serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        soft: "0 12px 40px rgba(31, 37, 51, .08)",
        lift: "0 18px 50px rgba(79, 70, 229, .16)",
      },
    },
  },
  plugins: [
    // short: a phone held sideways (or any very low window). Registered after
    // the breakpoints, so short: wins over sm:/md: where both apply.
    plugin(({ addVariant }) => { addVariant("short", "@media (orientation: landscape) and (max-height: 500px)"); }),
  ],
};
export default config;
