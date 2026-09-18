import Image from "next/image";
import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="ml-2 flex items-center text-ink">
      {compact ? (
        <Image src="/brand/registon-mark.png" alt="Registon" width={48} height={48} className="h-12 w-12 object-contain" priority />
      ) : (
        <Image src="/brand/registon-logo.png" alt="Registon o'quv markazi" width={260} height={73} className="h-12 w-auto object-contain" priority />
      )}
    </Link>
  );
}
