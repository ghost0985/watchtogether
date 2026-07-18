"use client";

import { useEffect, useState } from "react";

/**
 * Mirrors a CSS media query in JS. Starts `false` on both server and client
 * (matching what SSR can know) and updates after mount — same
 * avoid-a-hydration-mismatch shape as the myName/myLanguage fix in Room.tsx.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
