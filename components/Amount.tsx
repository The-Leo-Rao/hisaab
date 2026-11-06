"use client";

import { NumberTicker } from "@/components/ui/number-ticker";
import { toNumber, usdt } from "@/lib/format";
import { cn } from "@/lib/utils";

const sizes = { sm: "text-sm", md: "text-base", lg: "text-[22px] leading-7", hero: "amount-hero" };

export function Amount({
  units,
  size = "md",
  ticker = false,
  unit = true,
  className,
}: {
  units: bigint | string;
  size?: keyof typeof sizes;
  ticker?: boolean;
  unit?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("num whitespace-nowrap", sizes[size], className)}>
      {ticker ? <NumberTicker value={toNumber(units)} decimalPlaces={2} /> : usdt(units)}
      {unit && <span className={cn("ml-1.5 font-sans font-medium text-ink-3", size === "hero" ? "text-lg md:text-xl" : "text-[0.8em]")}>USDT</span>}
    </span>
  );
}
