"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api, toBase64, type VerifyResult } from "@/lib/api";
import { cn } from "@/lib/utils";

function SheetIcon({ lift }: { lift: boolean }) {
  return (
    <motion.svg viewBox="0 0 40 48" className="h-12 w-10 text-ink" animate={{ y: lift ? -4 : 0 }} transition={{ duration: 0.22 }} aria-hidden>
      <path d="M4 2h22l10 10v32a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#111318" stroke="currentColor" strokeWidth="1.5" />
      <path d="M26 2v10h10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 22h20M9 28h20M9 34h13" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" />
    </motion.svg>
  );
}

export function PdfDropZone({ id, onResult }: { id?: string; onResult: (r: VerifyResult) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function use(file?: File) {
    if (!file) return;
    if (file.type && file.type !== "application/pdf") return toast.error("That isn't a PDF.");
    setBusy(true);
    try {
      onResult(await api.verifyWith({ id, pdf: toBase64(await file.arrayBuffer()) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        use(e.dataTransfer.files[0]);
      }}
      className={cn(
        "flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-rule-strong px-6 py-8 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink",
        over && "border-solid border-ink bg-paper-2/60",
      )}
    >
      <SheetIcon lift={over} />
      <span className="font-medium">{busy ? "Reading the PDF…" : "Drop a sealed हिsaab invoice PDF"}</span>
      <span className="text-sm text-ink-3">or click to choose a file. You'll need its invoice key to open it.</span>
      <input ref={input} type="file" accept="application/pdf" className="sr-only" onChange={(e) => use(e.target.files?.[0])} />
    </label>
  );
}
