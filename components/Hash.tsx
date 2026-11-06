"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { middle } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className={cn("inline-grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink", className)}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          toast("Copied");
          setTimeout(() => setDone(false), 1200);
        })
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={done ? "ok" : "copy"} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }}>
          {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function Hash({
  value,
  href,
  head = 6,
  tail = 4,
  copy = true,
  className,
}: {
  value?: string | null;
  href?: string;
  head?: number;
  tail?: number;
  copy?: boolean;
  className?: string;
}) {
  if (!value) return <span className="num text-ink-3">—</span>;
  const text = middle(value, head, tail);
  return (
    <span className={cn("inline-flex items-center gap-0.5 align-middle", className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink" title={value}>
          {text}
          <ExternalLink className="size-3 text-ink-3" />
        </a>
      ) : (
        <span className="num" title={value}>
          {text}
        </span>
      )}
      {copy && <CopyButton text={value} label={`Copy ${value}`} />}
    </span>
  );
}
