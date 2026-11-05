import Image from "next/image";
import Link from "next/link";
import { BrandImage } from "./brand-image";

export function Logo({ compact = false, darkSurface = false }: { compact?: boolean; darkSurface?: boolean }) {
  return (
    <Link href="/" className="ml-0 flex min-w-0 shrink items-center sm:ml-2 text-ink">
      {compact ? (
        <Image src="/brand/registon-mark.png" alt="Registon" width={48} height={48} className="h-12 w-12 object-contain" priority />
      ) : (
        <BrandImage className="w-[142px] max-w-full sm:w-[188px]" darkSurface={darkSurface} />
      )}
    </Link>
  );
}
