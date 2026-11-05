"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  useEffect(() => setPending(false), [pathname]);
  useEffect(() => {
    const start = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.download || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href);
      if (url.origin === window.location.origin && url.pathname !== window.location.pathname) setPending(true);
    };
    document.addEventListener("click", start, true);
    return () => document.removeEventListener("click", start, true);
  }, []);
  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => setPending(false), 15000);
    return () => window.clearTimeout(timeout);
  }, [pending]);
  return pending ? <div className="navigation-progress" role="status" aria-label="Opening page"><span /></div> : null;
}
