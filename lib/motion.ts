"use client";

import { useEffect, useState } from "react";

export const dur = { micro: 0.12, short: 0.22, base: 0.4, long: 0.7 };
export const ease = {
  standard: [0.2, 0, 0, 1] as const,
  out: [0, 0, 0.2, 1] as const,
  in: [0.4, 0, 1, 1] as const,
};
export const spring = {
  stamp: { type: "spring" as const, stiffness: 700, damping: 22, mass: 0.9 },
  settle: { type: "spring" as const, stiffness: 260, damping: 30 },
};
export const stagger = { checks: 0.32, rows: 0.04 };

export function isDemo(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("demo") === "1") sessionStorage.setItem("hisaab:demo", "1");
    return sessionStorage.getItem("hisaab:demo") === "1";
  } catch {
    return false;
  }
}

export function useHero(): number {
  const [k, setK] = useState(1);
  useEffect(() => setK(isDemo() ? 1.25 : 1), []);
  return k;
}
