import Image from "next/image";
import styles from "./brand-image.module.css";

export function BrandImage({ className = "", darkSurface = false }: { className?: string; darkSurface?: boolean }) {
  return <span className={`${styles.frame} ${className}`} data-dark-surface={darkSurface || undefined}>
    <Image className={styles.light} src="/brand/registon-light.png" alt="Registon o‘quv markazi" width={6000} height={2317} sizes="260px" priority />
    <Image className={styles.dark} src="/brand/registon-dark.png" alt="Registon o‘quv markazi" width={6000} height={2317} sizes="260px" priority />
  </span>;
}
