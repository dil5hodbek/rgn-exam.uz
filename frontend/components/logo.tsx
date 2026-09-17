import Image from "next/image";
import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center text-ink">
      {compact ? (
        <Image src="/brand/registon-mark.png" alt="Registon" width={36} height={36} className="h-9 w-9 object-contain" priority />
      ) : (
        <Image src="/brand/registon-logo.png" alt="Registon o'quv markazi" width={200} height={56} className="h-9 w-auto object-contain" priority />
      )}
    </Link>
  );
}
