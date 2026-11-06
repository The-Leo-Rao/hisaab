import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Ledger({ cols, children, className }: { cols: string; children: ReactNode; className?: string }) {
  return (
    <div role="table" className={cn("w-full", className)} style={{ "--cols": cols } as CSSProperties}>
      {children}
    </div>
  );
}

export function LedgerHead({ children }: { children: ReactNode }) {
  return (
    <div role="row" className="hidden items-center gap-4 border-y border-rule-strong bg-paper-2 px-4 py-2.5 md:grid md:[grid-template-columns:var(--cols)]">
      {children}
    </div>
  );
}

export function LedgerTh({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <div role="columnheader" className={cn("label", right && "text-right")}>
      {children}
    </div>
  );
}

export function LedgerRowBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="row" className={cn("grid gap-x-4 gap-y-1.5 border-b border-rule px-4 py-3 transition-colors hover:bg-paper-2/50 md:items-center md:[grid-template-columns:var(--cols)]", className)}>
      {children}
    </div>
  );
}

export function Cell({ label, children, right, className }: { label?: string; children?: ReactNode; right?: boolean; className?: string }) {
  return (
    <div
      role="cell"
      data-label={label}
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 md:block",
        label && "before:label before:content-[attr(data-label)] md:before:content-none",
        right && "md:text-right",
        className,
      )}
    >
      <div className={cn("min-w-0", right && "text-right")}>{children}</div>
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 border-b border-rule px-6 py-14 text-center">
      <svg viewBox="0 0 120 80" className="h-20 w-32 text-ink" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <rect x="14" y="8" width="92" height="64" rx="3" />
        <path d="M26 8v64" strokeOpacity=".35" />
        <path d="M14 22h92M14 34h92M14 46h92M14 58h92" strokeOpacity=".25" />
        <path d="M84 8v64" strokeOpacity=".35" />
        <path d="M34 28h30M34 40h22" />
        <path d="M90 28h10M92 40h8" />
      </svg>
      <p className="max-w-sm text-ink-2">{text}</p>
      {action}
    </div>
  );
}
