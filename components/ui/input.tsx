import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-sm border border-rule-strong bg-card px-3 text-[15px] text-ink placeholder:text-ink-3 outline-none transition-colors focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:opacity-50 aria-invalid:border-bad",
        className,
      )}
      {...props}
    />
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-sm text-ink-3">{hint}</span>}
    </label>
  );
}

export { Input, Field };
