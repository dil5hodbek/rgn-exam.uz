import Image from "next/image";
import Link from "next/link";
import { BrandImage } from "./brand-image";

// Inside the app the logo is "home" for a signed-in user; on the sign-in
// pages there is no dashboard to go to yet, so they point it at the landing page.
export function Logo({ compact = false, darkSurface = false, href = "/dashboard" }: { compact?: boolean; darkSurface?: boolean; href?: string }) {
  return (
    <Link href={href} className="ml-0 flex min-w-0 shrink items-center sm:ml-2 text-ink">
      {compact ? (
        <Image src="/brand/registon-mark.png" alt="Registon" width={48} height={48} className="h-12 w-12 object-contain" priority />
      ) : (
        <BrandImage className="w-[142px] max-w-full sm:w-[188px]" darkSurface={darkSurface} />
      )}
    </Link>
  );
}
