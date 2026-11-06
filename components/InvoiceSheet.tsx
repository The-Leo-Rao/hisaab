"use client";

import { useState, type ReactNode } from "react";
import { useAnimate } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { InvoiceDoc } from "@hisaab/core";
import { group } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Hash } from "./Hash";

type PartyLike = { legalName?: string; ens?: string; wallet?: string };

function Party({ role, p }: { role: string; p?: PartyLike }) {
  return (
    <div className="min-w-0">
      <div className="label mb-1">{role}</div>
      <div className="font-medium">{p?.legalName || "—"}</div>
      {p?.ens && <div className="num truncate text-sm text-ink-2">{p.ens}</div>}
      {p?.wallet ? <Hash value={p.wallet} className="text-sm text-ink-3" /> : <div className="text-sm text-ink-3">Anyone with the link</div>}
    </div>
  );
}

export type SheetDoc = Pick<InvoiceDoc, "invoiceNumber" | "issueDate" | "dueDate" | "supplier" | "customer" | "lines" | "total" | "subtotal" | "engagement"> &
  Partial<Pick<InvoiceDoc, "settlement" | "currency">>;

export function InvoiceSheet({
  doc,
  id,
  docHash,
  stamp,
  collapsible = false,
  className,
  footer,
}: {
  doc: SheetDoc;
  id?: string | bigint;
  docHash?: string;
  stamp?: (onLand: () => void) => ReactNode;
  collapsible?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  const [scope, animate] = useAnimate();
  const [open, setOpen] = useState(!collapsible);
  const nudge = () => {
    if (scope.current) animate(scope.current, { y: [0, 2, 0] }, { duration: 0.18 });
  };
  const contractor = doc.engagement?.kind === "contract-employee";

  return (
    <article
      ref={scope}
      className={cn("relative overflow-hidden rounded-md border border-rule bg-card shadow-[var(--shadow-sheet)]", className)}
      aria-label={`Invoice ${doc.invoiceNumber}`}
    >
      <span aria-hidden className="absolute inset-y-0 left-6 w-[2px] bg-bad-fill/20 md:left-8" />
      <div className="py-6 pr-5 pl-10 md:py-8 md:pr-8 md:pl-14">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="label">{contractor ? "Contractor invoice" : "Tax invoice"}</div>
            <div className="mt-1 font-display text-[32px] leading-9">{doc.invoiceNumber || "Untitled"}</div>
            <div className="num mt-1 text-sm text-ink-2">
              {id !== undefined && <>#{String(id)} · </>}
              issued {doc.issueDate} · due {doc.dueDate}
            </div>
          </div>
          {stamp && <div className="absolute top-4 right-4 z-10 md:top-6 md:right-6">{stamp(nudge)}</div>}
        </header>

        <div className="mt-6 grid gap-5 border-t border-rule pt-5 sm:grid-cols-2">
          <Party role="From" p={doc.supplier as PartyLike} />
          <Party role="Billed to" p={doc.customer as PartyLike} />
        </div>

        {contractor && doc.engagement && (
          <div className="mt-5 grid gap-4 border-t border-rule pt-4 text-sm sm:grid-cols-2">
            <div>
              <div className="label">Engagement</div>
              <div>
                {doc.engagement.role || "Contractor"} at <span className="num">{doc.engagement.employer || "—"}</span>
              </div>
            </div>
            <div>
              <div className="label">Period</div>
              <div className="num">
                {doc.engagement.periodFrom || "?"} → {doc.engagement.periodTo || "?"}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6">
          {collapsible ? (
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between border-b border-rule pb-2 text-left" aria-expanded={open}>
              <span className="label">Line items · {doc.lines.length}</span>
              <ChevronDown className={cn("size-4 text-ink-3 transition-transform", open && "rotate-180")} />
            </button>
          ) : (
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-rule pb-2 sm:grid-cols-[1fr_56px_96px_110px]">
              <span className="label">Description</span>
              <span className="label hidden text-right sm:block">{contractor ? "Hours" : "Qty"}</span>
              <span className="label hidden text-right sm:block">Unit</span>
              <span className="label text-right">Amount</span>
            </div>
          )}
          {open &&
            doc.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-4 border-b border-rule py-2.5 text-[15px] sm:grid-cols-[1fr_56px_96px_110px]">
                <span className="min-w-0">
                  {l.description || <span className="text-ink-3">—</span>}
                  <span className="num block text-[13px] text-ink-3 sm:hidden">
                    {l.qty} × {group(String(l.unitPrice))}
                  </span>
                </span>
                <span className="num hidden text-right sm:block">{l.qty}</span>
                <span className="num hidden text-right sm:block">{group(String(l.unitPrice))}</span>
                <span className="num text-right">{group(String(l.amount))}</span>
              </div>
            ))}
          <div className="flex items-baseline justify-between pt-4">
            <span className="label">Total</span>
            <span className="num text-[22px] font-medium">
              {group(doc.total)} <span className="font-sans text-sm text-ink-3">USDT</span>
            </span>
          </div>
        </div>

        {(doc.settlement || docHash) && (
          <div className="mt-6 grid gap-3 border-t border-rule pt-4 text-sm sm:grid-cols-2">
            {doc.settlement && (
              <div>
                <div className="label">Settlement</div>
                <div>USDT on Whitechain ({doc.settlement.chainId})</div>
                <div className="flex items-center gap-1 text-ink-3">
                  registry <Hash value={doc.settlement.registry} />
                </div>
              </div>
            )}
            {docHash && (
              <div>
                <div className="label">Document hash</div>
                <Hash value={docHash} head={10} tail={8} />
              </div>
            )}
          </div>
        )}
        {footer}
      </div>
    </article>
  );
}
