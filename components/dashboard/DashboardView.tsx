"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, FilePlus2, Wallet } from "lucide-react";
import { explainError, isPayable, remaining, type OnchainInvoice } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { useProfile, type Profile } from "@/lib/profile";
import { useSubnames } from "@/lib/subnames";
import { loadDoc } from "@/lib/store";
import { isZero, longDate, middle, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/Ledger";
import { StatusBadge } from "@/components/StatusBadge";

type Row = { inv: OnchainInvoice; overdue: boolean };

const now = () => BigInt(Math.floor(Date.now() / 1000));
const counterparty = (i: OnchainInvoice, side: "issuer" | "client") => {
  const doc = loadDoc(i.docHash);
  if (side === "issuer") return doc?.supplier.ens || i.issuerName || middle(i.issuer);
  return doc?.customer.ens || i.clientName || (isZero(i.client) ? "Anyone with the link" : middle(i.client));
};

function useRows(side: "issuer" | "client") {
  const { cfg, me, tick } = useHisaab();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!cfg || !me) return;
    let live = true;
    (async () => {
      const list = side === "issuer" ? await cfg.hisaab.invoicesByIssuer(me) : await cfg.hisaab.invoicesByClient(me);
      const overdue = await Promise.all(list.map((i) => cfg.hisaab.isOverdue(i.id)));
      if (live) setRows(list.map((inv, i) => ({ inv, overdue: overdue[i] })).reverse());
    })().catch((e) => live && setError(explainError(e)));
    return () => {
      live = false;
    };
  }, [cfg, me, tick, side]);
  return { rows, error };
}

function Stat({ label, value, money, hint }: { label: string; value: number | null; money?: boolean; hint?: string }) {
  return (
    <div className="bg-paper p-5">
      <div className="label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        {value === null ? <span className="skeleton h-8 w-20" /> : <NumberTicker value={value} decimalPlaces={money ? 2 : 0} className="text-[30px] leading-none font-medium" />}
        {money && value !== null && <span className="text-sm text-ink-3">USDT</span>}
      </div>
      {hint && <div className="mt-1 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

function InvoiceTile({ row, side, large }: { row: Row; side: "issuer" | "client"; large?: boolean }) {
  const { inv, overdue } = row;
  const k = inv.id.toString();
  return (
    <Link
      href={`/verify/${k}`}
      className={cn("group grid shrink-0 content-between gap-4 border border-rule bg-card p-5 transition-colors hover:border-accent/60", large ? "min-h-48" : "w-64 min-h-40")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="num text-[12px] text-ink-3">#{k}</div>
          <div className="mt-1 truncate font-medium">{counterparty(inv, side === "issuer" ? "client" : "issuer")}</div>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-ink-3 transition-colors group-hover:text-accent" />
      </div>
      <div>
        <Amount units={isPayable(inv) ? remaining(inv) : inv.amount} size={large ? "lg" : "md"} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={inv.status} refunded={inv.refunded} overdue={overdue} />
          <span className="num text-[12px] text-ink-3">due {longDate(inv.dueDate)}</span>
        </div>
      </div>
    </Link>
  );
}

function Corporate({ profile }: { profile: Profile }) {
  const { rows, error } = useRows("client");
  const people = useSubnames(profile.ens, 0);
  const payable = (rows ?? []).filter((r) => isPayable(r.inv));
  const upcoming = [...payable].sort((a, b) => Number(a.inv.dueDate - b.inv.dueDate)).slice(0, 6);
  const outstanding = payable.reduce((s, r) => s + remaining(r.inv), 0n);
  const paidOut = (rows ?? []).reduce((s, r) => s + r.inv.paid - r.inv.refunded, 0n);
  const active = people.members.filter((m) => m.info?.status === "registered" && !m.info.revoked).length;

  return (
    <div>
      <PageTitle
        title={<>{profile.name}</>}
        sub={<span className="num">{profile.ens}</span>}
        right={
          <Button asChild>
            <Link href="/payables">
              <Wallet /> Open payroll
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-px border border-rule bg-rule md:grid-cols-4">
        <Stat label="Open invoices" value={rows ? payable.length : null} hint="addressed to this wallet" />
        <Stat label="Outstanding" value={rows ? toNumber(outstanding) : null} money />
        <Stat label="Paid out" value={rows ? toNumber(paidOut) : null} money hint="net of refunds" />
        <Stat label="People" value={people.loading ? null : active} hint="active subnames" />
      </div>

      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="title">Upcoming invoices</h2>
          <Link href="/payables" className="flex items-center gap-1 text-sm text-ink-2 hover:text-accent">
            Pay in payroll <ArrowRight className="size-4" />
          </Link>
        </div>
        {error && <p className="mb-4 text-bad">{error}</p>}
        {!rows ? (
          <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-48" />)}</div>
        ) : upcoming.length === 0 ? (
          <EmptyState text="Nothing to pay. Invoices that name this wallet as the client show up here." />
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {upcoming.map((r) => (
              <InvoiceTile key={r.inv.id.toString()} row={r} side="client" large />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Freelancer({ profile }: { profile: Profile }) {
  const { rows, error } = useRows("issuer");
  const t = now();
  const upcoming = (rows ?? []).filter((r) => isPayable(r.inv) && r.inv.dueDate >= t).sort((a, b) => Number(a.inv.dueDate - b.inv.dueDate)).slice(0, 3);
  const elapsed = (rows ?? []).filter((r) => !upcoming.includes(r)).slice(0, 10);

  return (
    <div>
      <PageTitle
        title={<>{profile.name}</>}
        sub={<span className="num">{profile.ens}</span>}
        right={
          <Button asChild>
            <Link href="/create">
              <FilePlus2 /> New invoice
            </Link>
          </Button>
        }
      />
      {error && <p className="mb-4 text-bad">{error}</p>}

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="title">Elapsed</h2>
          <Link href="/invoices" className="flex items-center gap-1 text-sm text-ink-2 hover:text-accent">
            All invoices <ArrowRight className="size-4" />
          </Link>
        </div>
        {!rows ? (
          <div className="flex gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-40 w-64 shrink-0" />)}</div>
        ) : elapsed.length === 0 ? (
          <p className="border border-dashed border-rule-strong p-6 text-ink-3">Paid, cancelled and past-due invoices collect here.</p>
        ) : (
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
            {elapsed.map((r) => (
              <InvoiceTile key={r.inv.id.toString()} row={r} side="issuer" />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="title mb-4">Upcoming</h2>
        {!rows ? (
          <div className="skeleton h-48" />
        ) : upcoming.length === 0 ? (
          <EmptyState
            text="No open invoices. Bill a client and it shows up here until it's paid."
            action={
              <Button asChild>
                <Link href="/create">New invoice</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {upcoming.map((r) => (
              <InvoiceTile key={r.inv.id.toString()} row={r} side="issuer" large />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function DashboardView() {
  const { profile } = useProfile();
  if (!profile) return null;
  return profile.role === "corporate" ? <Corporate profile={profile} /> : <Freelancer profile={profile} />;
}
