"use client";

import { forwardRef, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { cn } from "@/lib/utils";

export type BeamPhase = "idle" | "signing" | "relaying" | "mined" | "done";

const Node = forwardRef<HTMLDivElement, { label: string; sub: string; pulse?: boolean; ok?: boolean; tag?: string }>(function Node({ label, sub, pulse, ok, tag }, ref) {
  return (
    <div className="relative z-10 flex flex-col items-center">
      {tag && <span className="num absolute -top-6 rounded-sm border border-ok/50 bg-card px-1.5 text-[11px] text-ok">{tag}</span>}
      <motion.div
        ref={ref}
        animate={pulse ? { scale: [1, 1.04, 1] } : { scale: 1 }}
        transition={pulse ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        className={cn(
          "flex min-w-[118px] flex-col items-center rounded-sm border bg-card px-3 py-2 text-center transition-colors duration-300",
          ok ? "border-ok/60 bg-ok-fill/10" : "border-rule-strong",
        )}
      >
        <span className="flex items-center gap-1 text-sm font-medium">
          {ok && <Check className="size-3.5 text-ok" strokeWidth={3} />}
          {label}
        </span>
        <span className="text-[12px] text-ink-3">{sub}</span>
      </motion.div>
    </div>
  );
});

export function GaslessBeam({
  phase,
  payer = "Client",
  issuer = "Issuer",
  className,
  vertical = false,
}: {
  phase: BeamPhase;
  payer?: string;
  issuer?: string;
  className?: string;
  vertical?: boolean;
}) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const c = useRef<HTMLDivElement>(null);
  const d = useRef<HTMLDivElement>(null);
  const done = phase === "done";
  const still = reduced || phase === "idle";
  const common = { containerRef: box, pathColor: "#f1f0ec", pathOpacity: 0.14, pathWidth: 2, gradientStartColor: "#f5b62a", gradientStopColor: "#46d99b" };
  const loop = phase === "relaying" || phase === "signing";

  return (
    <div
      ref={box}
      className={cn("relative flex justify-between gap-6 py-8", vertical ? "flex-col items-center" : "flex-col items-center md:flex-row", className)}
      aria-label="Payment path: client signs, relayer pays gas, Whitechain registry records it, issuer receives USDT"
    >
      <Node ref={a} label={payer} sub="signs once" pulse={phase === "signing" && !reduced} ok={done} tag="0 gas" />
      <Node ref={b} label="Relayer" sub="pays the gas" ok={done} />
      <Node ref={c} label="Whitechain" sub="registry records it" ok={done} />
      <Node ref={d} label={issuer} sub="receives USDT" ok={done} />
      <AnimatedBeam key={`ab-${phase}`} {...common} fromRef={a} toRef={b} still={still || done} duration={1.6} repeat={loop ? Infinity : 0} />
      <AnimatedBeam key={`bc-${phase}`} {...common} fromRef={b} toRef={c} still={still || done || phase === "signing"} duration={1.6} delay={0.4} repeat={loop ? Infinity : 0} />
      <AnimatedBeam key={`cd-${phase}`} {...common} fromRef={c} toRef={d} still={still || phase !== "mined"} duration={0.9} repeat={0} />
    </div>
  );
}
