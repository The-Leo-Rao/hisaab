"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Activity } from "lucide-react";
import { explainError, isPayable, remaining, type OnchainInvoice } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { dur, stagger } from "@/lib/motion";
import { longDate, middle, toNumber, usdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadDoc } from "@/lib/store";

const issuerOf = (i: OnchainInvoice) => loadDoc(i.docHash)?.supplier.ens || i.issuerName || "";
const whoOf = (i: OnchainInvoice) => issuerOf(i) || middle(i.issuer);
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AnimatedListItem } from "@/components/ui/animated-list";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Amount } from "@/components/Amount";
import { Hash } from "@/components/Hash";
import { useEnsName } from "@/components/IdentityChip";
import { Cell, EmptyState, Ledger, LedgerHead, LedgerRowBody, LedgerTh } from "@/components/Ledger";
import { StatusBadge } from "@/components/StatusBadge";

type Row = { inv: OnchainInvoice; overdue: boolean };
type Event = { id: string; who: string; amount: bigint; txHash: string; key: string };
type Filter = "payable" | "paid" | "all";

function Role({ name }: { name: string }) {
  const ens = useEnsName(name);
  const r = ens?.records ?? {};
  const text = r["hisaab.role"] ?? (r["hisaab.client"] ? "Freelance engagement" : ens ? "—" : "…");
  return <span className="block truncate text-[12px] text-ink-3">{text}</span>;
}

function Feed({ events }: { events: Event[] }) {
  const { txUrl } = useHisaab();
  if (!events.length) return <p className="text-sm text-ink-3">Payments you make show up here as they confirm.</p>;
  return (
    <div className="grid gap-2">
      <AnimatePresence initial={false}>
        {events.map((e) => (
          <AnimatedListItem key={e.key}>
            <div className="rounded-sm border border-rule bg-card px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{e.who}</span>
                <Amount units={e.amount} size="sm" unit={false} />
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[12px] text-ink-3">
                <span className="num">#{e.id} paid</span>
                <Hash value={e.txHash} href={txUrl(e.txHash)} copy={false} head={6} tail={4} />
              </div>
            </div>
          </AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function PayablesView() {
  const { cfg, signer, me, tick, refresh } = useHisaab();
  const reduced = useReducedMotion();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("payable");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<{ total: number; done: number; amount: bigint; phase: string } | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<Event[]>([]);

  const load = useCallback(async () => {
    if (!cfg || !me) return;
    try {
      const list = await cfg.hisaab.invoicesByClient(me);
      const overdue = await Promise.all(list.map((i) => cfg.hisaab.isOverdue(i.id)));
      setRows(list.map((inv, i) => ({ inv, overdue: overdue[i] })).reverse());
      const paidOnes = list.filter((i) => i.paid > 0n).slice(-8);
      const pays = await Promise.all(paidOnes.map(async (i) => (await cfg.hisaab.payments(i.id)).map((p) => ({ id: i.id.toString(), who: whoOf(i), amount: p.amount, txHash: p.txHash, key: p.txHash, block: p.blockNumber }))));
      setEvents((cur) => (cur.length ? cur : pays.flat().sort((a, b) => Number(b.block - a.block)).slice(0, 8)));
      setError(null);
    } catch (e) {
      setError(explainError(e));
    }
  }, [cfg, me]);

  useEffect(() => {
    setRows(null);
    setPicked(new Set());
    setGone(new Set());
    setEvents([]);
  }, [me]);

  useEffect(() => {
    load();
  }, [load, tick]);

  const payable = useMemo(() => (rows ?? []).filter((r) => isPayable(r.inv)), [rows]);
  const shown = (rows ?? []).filter((r) =>
    filter === "all" ? true : filter === "paid" ? r.inv.status === "Paid" : isPayable(r.inv) || (!!paying && gone.has(r.inv.id.toString())),
  );
  const selected = payable.filter((r) => picked.has(r.inv.id.toString()));
  const selTotal = selected.reduce((s, r) => s + remaining(r.inv), 0n);
  const dueTotal = payable.reduce((s, r) => s + remaining(r.inv), 0n);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function paySelected() {
    if (!cfg || !signer) return;
    const list = [...selected];
    const total = list.reduce((s, r) => s + remaining(r.inv), 0n);
    let paidSoFar = 0n;
    setPaying({ total: list.length, done: 0, amount: 0n, phase: "Approving the total once…" });
    try {
      await cfg.hisaab.ensureAllowance(signer, total);
      for (const [i, r] of list.entries()) {
        const k = r.inv.id.toString();
        setPaying({ total: list.length, done: i, amount: paidSoFar, phase: `Paying #${k}…` });
        const amt = remaining(r.inv);
        const res = await cfg.hisaab.pay(signer, r.inv.id, amt);
        paidSoFar += amt;
        setGone((g) => new Set(g).add(k));
        setPicked((p) => {
          const n = new Set(p);
          n.delete(k);
          return n;
        });
        setEvents((ev) => [{ id: k, who: whoOf(r.inv), amount: amt, txHash: res.txHash, key: res.txHash }, ...ev].slice(0, 12));
        setPaying({ total: list.length, done: i + 1, amount: paidSoFar, phase: "" });
      }
      setTimeout(() => {
        setPaying(null);
        refresh();
      }, 1600);
    } catch (e) {
      setPaying((p) => (p ? { ...p, phase: explainError(e) } : null));
      setTimeout(() => {
        setPaying(null);
        refresh();
      }, 4000);
    }
  }

  if (!me) return <EmptyState text="Connect the company wallet to see invoices addressed to it." />;

  return (
    <div className="pb-24">
      <PageTitle
        title={<>Pay<em>roll</em></>}
        sub="Every invoice that names this wallet as the client. Nobody else can bill you through this list."
        right={
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary" className="lg:hidden">
                <Activity /> Activity
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle>Activity</SheetTitle>
              <Feed events={events} />
            </SheetContent>
          </Sheet>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(["payable", "paid", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn("h-9 rounded-sm border px-3 text-sm capitalize", filter === f ? "border-ink bg-ink text-paper" : "border-rule-strong text-ink-2 hover:bg-paper-2")}
              >
                {f}
              </button>
            ))}
            <span className="ml-auto text-sm text-ink-3">
              {payable.length} payable · <span className="num">{usdt(dueTotal)}</span> USDT outstanding
            </span>
          </div>

          {error && <p className="mb-4 text-bad">{error}</p>}
          <Ledger cols="28px 44px minmax(0,1fr) 104px 128px 104px">
            <LedgerHead>
              <Checkbox
                aria-label="Select all payable"
                checked={payable.length > 0 && selected.length === payable.length}
                onCheckedChange={(v) => setPicked(v ? new Set(payable.map((r) => r.inv.id.toString())) : new Set())}
              />
              <LedgerTh>#</LedgerTh>
              <LedgerTh>From</LedgerTh>
              <LedgerTh right>Amount</LedgerTh>
              <LedgerTh>Status</LedgerTh>
              <LedgerTh>Due</LedgerTh>
            </LedgerHead>
            {!rows && [0, 1, 2].map((i) => <div key={i} className="skeleton my-2 h-12" />)}
            {rows && shown.length === 0 && <EmptyState text={filter === "payable" ? "Nothing to pay right now." : "No invoices here yet."} />}
            <AnimatePresence initial={false}>
              {shown.map((r, i) => {
                const k = r.inv.id.toString();
                const struck = gone.has(k) && filter === "payable";
                return (
                  <motion.div
                    key={k}
                    layout={!reduced}
                    initial={false}
                    animate={struck ? { height: 0, opacity: 0 } : { height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: dur.base, delay: struck ? 0.45 + i * stagger.rows : 0 }}
                    className="overflow-hidden"
                  >
                    <LedgerRowBody className="relative">
                      <Cell>
                        <Checkbox checked={picked.has(k)} disabled={!isPayable(r.inv) || !!paying} onCheckedChange={() => toggle(k)} aria-label={`Select invoice ${k}`} />
                      </Cell>
                      <Cell label="Invoice">
                        <span className="num">#{k}</span>
                      </Cell>
                      <Cell label="From">
                        <span className="block font-medium break-all">{whoOf(r.inv)}</span>
                        {issuerOf(r.inv) && <Role name={issuerOf(r.inv)} />}
                      </Cell>
                      <Cell label="Amount" right>
                        <Amount units={isPayable(r.inv) ? remaining(r.inv) : r.inv.amount} size="sm" unit={false} />
                      </Cell>
                      <Cell label="Status">
                        <StatusBadge status={gone.has(k) ? "Paid" : r.inv.status} refunded={r.inv.refunded} overdue={r.overdue && !gone.has(k)} />
                      </Cell>
                      <Cell label="Due">
                        <span className="num text-sm">{longDate(r.inv.dueDate)}</span>
                      </Cell>
                      {struck && (
                        <motion.span
                          aria-hidden
                          className="absolute top-1/2 right-4 left-4 h-px origin-left bg-ink"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: dur.short }}
                        />
                      )}
                    </LedgerRowBody>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Ledger>
          <p className="mt-4 text-sm text-ink-3">Check the hours and the rate before paying: the registry records what was billed, not whether it was right.</p>
        </div>

        <aside className="hidden lg:block">
          <div className="label mb-3">Activity</div>
          <Feed events={events} />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 backdrop-blur-[2px]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-3 px-4 py-3 md:px-6" aria-live="polite">
          <Button variant="secondary" size="sm" disabled={!payable.length || !!paying} onClick={() => setPicked(new Set(payable.map((r) => r.inv.id.toString())))}>
            Select all payable
          </Button>
          <div className="ml-auto text-right">
            {paying ? (
              <>
                <div className="num text-[15px]">
                  Paid {paying.done} of {paying.total} · {usdt(paying.amount)} USDT
                </div>
                {paying.phase && <div className="text-[13px] text-ink-3">{paying.phase}</div>}
              </>
            ) : (
              <>
                <div className="label">{selected.length} selected</div>
                <div className="text-lg">
                  <NumberTicker value={toNumber(selTotal)} decimalPlaces={2} className="text-lg" /> <span className="text-sm text-ink-3">USDT</span>
                </div>
              </>
            )}
          </div>
          <Button onClick={paySelected} disabled={!selected.length || !signer || !!paying}>
            Pay selected
          </Button>
        </div>
      </div>
    </div>
  );
}
