"use client";

import { useEffect, useId, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { dur, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const INK = { paid: "#0e7a6d", verified: "#1d2f5e", void: "#b3261e" } as const;
const WORD = { paid: "PAID", verified: "VERIFIED", void: "VOID" } as const;

let flip = 1;

export function Stamp({
  variant,
  label,
  date,
  ariaLabel,
  delay = 0,
  onLand,
  className,
}: {
  variant: keyof typeof INK;
  label?: string;
  date?: string;
  ariaLabel?: string;
  delay?: number;
  onLand?: () => void;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const tilt = useRef((flip = -flip) * 4).current;
  const ink = INK[variant];
  const text = label ?? WORD[variant];
  const width = Math.max(150, text.length * 19 + 48);
  const landed = useRef(false);

  useEffect(() => {
    landed.current = false;
  }, [variant, text]);

  const land = () => {
    if (landed.current) return;
    landed.current = true;
    if (!reduced) {
      try {
        navigator.vibrate?.(12);
      } catch {}
    }
    onLand?.();
  };

  const svg = (
    <svg viewBox={`0 0 ${width} 92`} width={width} height={92} aria-hidden>
      <defs>
        <filter id={`ink-${id}`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feComponentTransfer in="noise" result="holes">
            <feFuncA type="discrete" tableValues="1 1 1 0.55 1 1 1 1" />
          </feComponentTransfer>
          <feComposite in="d" in2="holes" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#ink-${id})`} fill="none" stroke={ink}>
        <rect x="3" y="3" width={width - 6} height="86" rx="10" strokeWidth="3" />
        <rect x="10" y="10" width={width - 20} height="72" rx="6" strokeWidth="1.4" />
        <text
          x={width / 2}
          y={date ? 50 : 57}
          textAnchor="middle"
          fill={ink}
          stroke="none"
          style={{ font: "700 30px var(--font-geist), sans-serif", letterSpacing: "0.18em" }}
        >
          {text}
        </text>
        {date && (
          <text x={width / 2} y="70" textAnchor="middle" fill={ink} stroke="none" style={{ font: "500 11px var(--font-geist-mono), monospace", letterSpacing: "0.12em" }}>
            {date}
          </text>
        )}
      </g>
    </svg>
  );

  return (
    <div role="img" aria-label={ariaLabel ?? (date ? `${text} on ${date}` : text)} className={cn("pointer-events-none relative select-none", className)} style={{ mixBlendMode: "multiply" }}>
      <motion.div
        key={`${variant}-${text}`}
        className="absolute inset-0 blur-[3px]"
        initial={{ opacity: 0, rotate: tilt }}
        animate={{ opacity: 0.25, rotate: tilt }}
        transition={{ delay: delay + (reduced ? 0 : 0.15), duration: dur.long }}
      >
        {svg}
      </motion.div>
      <motion.div
        key={`main-${variant}-${text}`}
        initial={reduced ? { opacity: 0, rotate: tilt } : { opacity: 0, scale: 1.6, rotate: -8, y: -12 }}
        animate={{ opacity: 0.92, scale: 1, rotate: tilt, y: 0 }}
        transition={reduced ? { delay, duration: dur.short } : { ...spring.stamp, delay }}
        onAnimationComplete={land}
      >
        {svg}
      </motion.div>
    </div>
  );
}
