import { Ban, Check, Circle, CircleDashed, Clock, RotateCcw, Snowflake, X } from "lucide-react";
import type { StatusName } from "@hisaab/core";
import { cn } from "@/lib/utils";
import { toneBorder, toneSoft, toneText, type State } from "./tone";

type Kind = { word: string; state: State; Icon: typeof Check };

export function statusKind(status: StatusName, refunded: bigint | string = 0n, overdue = false): Kind {
  const r = BigInt(refunded);
  if (status === "Paid") return r > 0n ? { word: "Partly refunded", state: "warn", Icon: RotateCcw } : { word: "Paid", state: "ok", Icon: Check };
  if (status === "Refunded") return { word: "Refunded", state: "bad", Icon: X };
  if (status === "Cancelled") return { word: "Cancelled", state: "idle", Icon: Ban };
  if (status === "PartiallyPaid" && r > 0n) return { word: "Frozen", state: "bad", Icon: Snowflake };
  if (overdue) return { word: "Overdue", state: "warn", Icon: Clock };
  if (status === "PartiallyPaid") return { word: "Partly paid", state: "warn", Icon: CircleDashed };
  return { word: "Open", state: "idle", Icon: Circle };
}

export function StatusBadge({
  status,
  refunded,
  overdue,
  className,
}: {
  status: StatusName;
  refunded?: bigint | string;
  overdue?: boolean;
  className?: string;
}) {
  const k = statusKind(status, refunded, overdue);
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[13px] font-medium whitespace-nowrap",
        toneBorder[k.state],
        toneSoft[k.state],
        toneText[k.state],
        className,
      )}
    >
      <k.Icon className="size-3.5" strokeWidth={2.5} aria-hidden />
      {k.word}
    </span>
  );
}
