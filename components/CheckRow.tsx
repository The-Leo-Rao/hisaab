"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { dur, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { toneHex, toneText, type State } from "./tone";

const WORD: Record<State, string> = { ok: "Pass", warn: "Check", bad: "Fail", idle: "Not checked" };
const PATHS: Record<State, string[]> = {
  ok: ["M5 12.5l4.5 4.5L19 7.5"],
  bad: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  warn: ["M12 5.5v8.5", "M12 18v0.6"],
  idle: ["M6 12h12"],
};

function Mark({ state, animate }: { state: State; animate: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", toneText[state])} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
      {PATHS[state].map((d, i) => (
        <motion.path
          key={`${state}-${i}`}
          d={d}
          initial={animate ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: dur.short, delay: i * 0.08, ease: ease.out }}
        />
      ))}
    </svg>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(", ") : "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export type CheckRowProps = {
  code: string;
  title: string;
  state: State;
  detail: string;
  evidence?: Record<string, unknown>;
  resolved: boolean;
  delay?: number;
};

export function CheckRow({ code, title, state, detail, evidence, resolved, delay = 0 }: CheckRowProps) {
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate();
  const prev = useRef<{ state: State; detail: string } | null>(null);
  const [old, setOld] = useState<string | null>(null);
  const shown: State = resolved ? state : "idle";

  useEffect(() => {
    if (!resolved) return;
    const p = prev.current;
    prev.current = { state, detail };
    if (!p || (p.state === state && p.detail === detail)) return;
    setOld(p.detail);
    const t = setTimeout(() => setOld(null), 1400);
    if (!reduced && scope.current) {
      animate(scope.current, { x: [0, -3, 3, -2, 2, 0] }, { duration: 0.35 });
      animate(scope.current, { backgroundColor: [`${toneHex[state]}1f`, `${toneHex[state]}00`] }, { duration: dur.long });
    }
    return () => clearTimeout(t);
  }, [resolved, state, detail, reduced, animate, scope]);

  const entries = Object.entries(evidence ?? {});

  return (
    <div ref={scope} className="relative border-b border-rule last:border-b-0">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-4 md:grid-cols-[150px_1fr_auto]">
        <div className="flex flex-col justify-start">
          <span className="text-[15px] font-semibold">
            <span className="num mr-1.5 text-ink-3">{code}</span>
            {title}
          </span>
          {!resolved && (
            <span className="mt-1 inline-flex items-center gap-2 text-sm text-ink-3">
              <motion.span
                className="h-px w-10 origin-left bg-ink-3"
                animate={reduced ? undefined : { scaleX: [0.2, 1, 0.2] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              />
              checking…
            </span>
          )}
        </div>
        <div className="col-span-2 row-start-2 min-h-6 text-[15px] text-ink-2 md:col-span-1 md:row-start-1 md:col-start-2" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            {resolved && old && (
              <motion.p key={`old-${old}`} className="relative text-ink-3" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: dur.short } }}>
                {old}
                <motion.span
                  className="absolute top-1/2 left-0 h-px w-full origin-left bg-bad"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: dur.base, ease: ease.standard }}
                />
              </motion.p>
            )}
            {resolved && (
              <motion.p
                key={`${state}-${detail}`}
                initial={{ opacity: 0, y: old ? 6 : 0 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: dur.short, delay: old ? 0.35 : reduced ? 0 : delay + 0.1 }}
              >
                {detail}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <div className="col-start-2 row-start-1 flex items-start justify-end md:col-start-3">
          <span className={cn("inline-flex h-7 min-w-[76px] items-center justify-end gap-1.5 text-[13px] font-semibold uppercase tracking-[0.06em]", toneText[shown])}>
            {resolved && (
              <motion.span key={`w-${state}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduced ? 0 : delay + dur.short, duration: dur.short }}>
                {WORD[state]}
              </motion.span>
            )}
            <motion.span key={`m-${shown}`} initial={false} animate={{ opacity: 1 }} transition={{ delay: resolved && !reduced ? delay : 0 }}>
              {resolved ? <DelayedMark state={state} delay={reduced ? 0 : delay} animate={!reduced} /> : <Mark state="idle" animate={false} />}
            </motion.span>
          </span>
        </div>
      </div>
      {resolved && (
        <motion.span
          key={`u-${state}`}
          aria-hidden
          className="absolute bottom-[-1px] left-0 h-[2px] w-full origin-left"
          style={{ backgroundColor: toneHex[state], opacity: 0.4 }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: dur.base, delay, ease: ease.standard }}
        />
      )}
      {resolved && entries.length > 0 && (
        <details className="group mb-3 -mt-1 text-sm">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            Evidence
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm bg-paper-2/60 p-3">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="label self-baseline">{k}</dt>
                <dd className="num min-w-0 text-[13px] break-all text-ink-2">{fmt(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function DelayedMark({ state, delay, animate }: { state: State; delay: number; animate: boolean }) {
  const [go, setGo] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return setGo(true);
    setGo(false);
    const t = setTimeout(() => setGo(true), delay * 1000);
    return () => clearTimeout(t);
  }, [delay, state]);
  return go ? <Mark state={state} animate={animate} /> : <Mark state="idle" animate={false} />;
}
