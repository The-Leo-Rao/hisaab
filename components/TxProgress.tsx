"use client";

import { Check, Loader2, X } from "lucide-react";
import { motion } from "motion/react";
import { useHisaab } from "@/lib/hisaab";
import { cn } from "@/lib/utils";
import { Hash } from "./Hash";

export type Step = { label: string; state: "todo" | "active" | "done" | "error"; hash?: string };

export function TxProgress({ steps, error, urlFor }: { steps: Step[]; error?: string | null; urlFor?: (hash: string) => string | undefined }) {
  const { txUrl } = useHisaab();
  const link = urlFor ?? txUrl;
  return (
    <div aria-live="polite">
      <ol className="flex flex-col gap-0">
        {steps.map((s, i) => (
          <motion.li key={s.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-b-0">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-[11px]",
                s.state === "done" && "border-ok bg-ok-fill/15 text-ok",
                s.state === "active" && "border-ink text-ink",
                s.state === "error" && "border-bad bg-bad-fill/10 text-bad",
                s.state === "todo" && "border-rule-strong text-ink-3",
              )}
            >
              {s.state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : s.state === "active" ? <Loader2 className="size-3.5 animate-spin" /> : s.state === "error" ? <X className="size-3.5" /> : <span className="num">{i + 1}</span>}
            </span>
            <span className={cn("text-[15px]", s.state === "todo" ? "text-ink-3" : "text-ink")}>{s.label}</span>
            {s.hash && <Hash value={s.hash} href={link(s.hash)} className="ml-auto text-sm" />}
          </motion.li>
        ))}
      </ol>
      {error && (
        <p className="mt-3 rounded-sm border border-bad/40 bg-bad-fill/10 p-3 text-[15px] text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
