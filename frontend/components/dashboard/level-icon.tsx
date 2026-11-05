import { Sprout, Compass, Rocket, Crown } from "lucide-react";
import type { LevelCardData } from "@/lib/levels";
import styles from "./level-icon.module.css";

export const levelGradients = {
  coral: "from-[#ff8a46] to-[#dc5b20]",
  violet: "from-[#ff8a46] to-[#dc5b20]",
  blue: "from-[#ff8a46] to-[#dc5b20]",
  mint: "from-[#ff8a46] to-[#dc5b20]",
};

const symbols = { coral: Sprout, violet: Compass, blue: Rocket, mint: Crown };

export function LevelIcon({ level, compact = false }: { level: Pick<LevelCardData, "color" | "icon">; compact?: boolean }) {
  const Symbol = symbols[level.color];
  return <span aria-hidden="true" className={`${styles.art} ${styles[level.color]} ${compact ? styles.compact : ""}`}>
    <span className={styles.pedestal} />
    <span className={styles.badge}>
      <span className={styles.inset} />
      <Symbol className={styles.symbol} strokeWidth={2.2} />
    </span>
  </span>;
}
