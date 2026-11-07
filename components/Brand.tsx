import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans font-semibold tracking-tight", className)} aria-label="Hisaab">
      <span lang="hi" className="text-accent">
        हि
      </span>
      saab
    </span>
  );
}
