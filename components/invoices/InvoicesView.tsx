"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, FileDown, RotateCcw, ShieldCheck, Undo2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { buildInvoice, docHash, explainError, payLink, toUnits, totalUnits, type OnchainInvoice } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { downloadPdf } from "@/lib/api";
import { loadDoc, markSeen, saveDoc, seenReceipts } from "@/lib/store";
import { isZero, longDate, middle, usdt } from "@/lib/format";
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Amount } from "@/components/Amount";
import { Cell, EmptyState, Ledger, LedgerHead, LedgerRowBody, LedgerTh } from "@/components/Ledger";
import { ReceiptCard } from "@/components/ReceiptCard";
import { StatusBadge } from "@/components/StatusBadge";

type Row = { inv: OnchainInvoice; overdue: boolean; next: bigint; link: string | null };

function Act({ label, onClick, href, children, disabled }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode; disabled?: boolean }) {
  const btn = href ? (
    <Button variant="ghost" size="icon" asChild aria-label={label}>
      <Link href={href}>{children}</Link>
    </Button>
  ) : (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label={label} disabled={disabled}>
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function InvoicesView() {
  const { cfg, signer, me, tick, refresh } = useHisaab();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<OnchainInvoice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => setSeen(seenReceipts()), []);

  const load = useCallback(async () => {
    if (!cfg || !me) return;
    try {
      const list = await cfg.hisaab.invoicesByIssuer(me);
      const out = await Promise.all(
        list.reverse().map(async (inv) => {
          const doc = loadDoc(inv.docHash);
          const [overdue, next] = await Promise.all([cfg.hisaab.isOverdue(inv.id), cfg.hisaab.supersededBy(inv.id)]);
          return { inv, overdue, next, link: doc ? await payLink(window.location.origin, inv.id, doc) : null };
        }),
      );
      setRows(out);
      setError(null);
    } catch (e) {
      setError(explainError(e));
    }
  }, [cfg, me]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load, tick]);

  const paid = (rows ?? []).filter((r) => r.inv.status === "Paid");
  useEffect(() => {
    if (!cfg) return;
    for (const r of paid) {
      const k = `${r.inv.id}:${r.inv.refunded}`;
      if (k in images) continue;
      setImages((m) => ({ ...m, [k]: null }));
      cfg.hisaab.receiptImage(r.inv.id).then((img) => setImages((m) => ({ ...m, [k]: img })));
    }
  }, [cfg, paid.map((r) => `${r.inv.id}:${r.inv.refunded}`).join(",")]);

  const now = Math.floor(Date.now() / 1000);
  const outstanding = (rows ?? []).filter((r) => r.inv.refunded === 0n && (r.inv.status === "Open" || r.inv.status === "PartiallyPaid")).reduce((s, r) => s + r.inv.amount - r.inv.paid, 0n);
  const received = (rows ?? []).filter((r) => r.inv.paid > 0n && Number(r.inv.paidAt || r.inv.createdAt) > now - 30 * 86400).reduce((s, r) => s + r.inv.paid - r.inv.refunded, 0n);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok);
      refresh();
    } catch (e) {
      toast.error(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  async function reissue(inv: OnchainInvoice) {
    if (!cfg || !signer) return;
    const old = loadDoc(inv.docHash);
    if (!old) throw new Error("The original document isn't saved in this browser, so it can't be reissued from here.");
    const issueDate = new Date().toISOString().slice(0, 10);
    const doc = buildInvoice({
      ...old,
      invoiceNumber: `${old.invoiceNumber}-R`,
      issueDate,
      dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      lines: old.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice })),
      settlement: old.settlement,
      engagement: old.engagement,
    });
    const hash = docHash(doc);
    await cfg.hisaab.createInvoice(signer, {
      client: isZero(inv.client) ? undefined : inv.client,
      amount: totalUnits(doc),
      dueDate: BigInt(Math.floor(Date.now() / 1000) + 14 * 86_400),
      docHash: hash,
      issuerName: inv.issuerName,
      clientName: inv.clientName,
      supersedes: inv.id,
    });
    saveDoc(hash, doc);
  }

  if (!me) return <EmptyState text="Connect a wallet to see the invoices you issued." />;

  return (
    <div>
      <PageTitle title={<>Your <em>invoices</em></>} sub="Everything you issued, read straight from the registry." right={<Button asChild><Link href="/create">New invoice</Link></Button>} />

      <div className="mb-10 grid grid-cols-3 border-y border-rule">
        {[
          ["Outstanding", outstanding, true],
          ["Received (30d)", received, true],
          ["Receipts", BigInt(paid.length), false],
        ].map(([label, v, money], i) => (
          <div key={String(label)} className={`px-3 py-4 md:px-6 ${i ? "border-l border-rule" : ""}`}>
            <div className="label">{String(label)}</div>
            {rows ? (
              money ? <Amount units={v as bigint} size="lg" ticker unit={false} className="mt-1 block" /> : <span className="num mt-1 block text-[22px]">{String(v)}</span>
            ) : (
              <span className="skeleton mt-2 block h-6 w-24" />
            )}
          </div>
        ))}
      </div>

      <Tabs defaultValue="ledger">
        <TabsList className="mb-6">
          <TabsTrigger value="ledger">Invoices</TabsTrigger>
          <TabsTrigger value="receipts" onClick={() => setTimeout(() => markSeen(paid.map((r) => r.inv.id.toString())), 1500)}>
            Receipts · {paid.length}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          {error && <p className="mb-4 text-bad">{error}</p>}
          <Ledger cols="56px minmax(0,1.4fr) 120px 120px 150px 110px 176px">
            <LedgerHead>
              <LedgerTh>#</LedgerTh>
              <LedgerTh>Client</LedgerTh>
              <LedgerTh right>Amount</LedgerTh>
              <LedgerTh right>Paid</LedgerTh>
              <LedgerTh>Status</LedgerTh>
              <LedgerTh>Due</LedgerTh>
              <LedgerTh right>Actions</LedgerTh>
            </LedgerHead>
            {!rows && [0, 1, 2].map((i) => <div key={i} className="skeleton my-2 h-12" />)}
            {rows?.length === 0 && <EmptyState text="No invoices yet. Your first one takes a minute." action={<Button asChild><Link href="/create">Create an invoice</Link></Button>} />}
            {rows?.map(({ inv, overdue, next, link }) => {
              const k = inv.id.toString();
              const doc = loadDoc(inv.docHash);
              const hash = link ? new URL(link).hash : "";
              return (
                <LedgerRowBody key={k}>
                  <Cell label="Invoice">
                    <span className="num">#{k}</span>
                    {inv.supersedes > 0n && <span className="block text-[12px] text-ink-3">replaces #{inv.supersedes.toString()}</span>}
                    {next > 0n && <span className="block text-[12px] text-ink-3">replaced by #{next.toString()}</span>}
                  </Cell>
                  <Cell label="Client">
                    <span className="block truncate font-medium">{inv.clientName || "—"}</span>
                    <span className="num block text-[12px] text-ink-3">{isZero(inv.client) ? "anyone with the link" : middle(inv.client)}</span>
                  </Cell>
                  <Cell label="Amount" right>
                    <Amount units={inv.amount} size="sm" unit={false} />
                  </Cell>
                  <Cell label="Paid" right>
                    <Amount units={inv.paid} size="sm" unit={false} />
                    {inv.refunded > 0n && <span className="num block text-[12px] text-warn">−{usdt(inv.refunded)}</span>}
                  </Cell>
                  <Cell label="Status">
                    <StatusBadge status={inv.status} refunded={inv.refunded} overdue={overdue} />
                  </Cell>
                  <Cell label="Due">
                    <span className="num text-sm">{longDate(inv.dueDate)}</span>
                  </Cell>
                  <Cell className="justify-end md:flex md:justify-end">
                    <div className="flex flex-wrap justify-end">
                      {link && <Act label="Copy pay link" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Pay link copied"))}><Copy /></Act>}
                      {doc && (
                        <Act label="Invoice PDF" onClick={() => downloadPdf("/invoice-pdf", { id: k, document: doc }, `invoice-${k}.pdf`).catch((e) => toast.error(e.message))}>
                          <FileDown />
                        </Act>
                      )}
                      <Act label="Verify page" href={`/verify/${k}${hash}`}>
                        <ShieldCheck />
                      </Act>
                      {inv.status === "Open" && inv.paid === 0n && (
                        <Act label="Cancel" disabled={!!busy} onClick={() => run(`c${k}`, () => cfg!.hisaab.cancel(signer!, inv.id), `Invoice #${k} cancelled`)}>
                          <XCircle />
                        </Act>
                      )}
                      {(inv.status === "Paid" || inv.status === "PartiallyPaid") && (
                        <Act label="Refund" disabled={!!busy} onClick={() => setRefundFor(inv)}>
                          <Undo2 />
                        </Act>
                      )}
                      {(inv.status === "Cancelled" || inv.status === "Refunded") && next === 0n && doc && (
                        <Act label="Reissue" disabled={!!busy} onClick={() => run(`r${k}`, () => reissue(inv), `Invoice #${k} reissued`)}>
                          <RotateCcw />
                        </Act>
                      )}
                    </div>
                  </Cell>
                </LedgerRowBody>
              );
            })}
          </Ledger>
        </TabsContent>

        <TabsContent value="receipts">
          {paid.length === 0 ? (
            <EmptyState text="Receipts appear here when an invoice is paid in full." />
          ) : (
            <div className="grid gap-8 sm:grid-cols-2">
              {paid.map((r) => {
                const k = r.inv.id.toString();
                const ik = `${k}:${r.inv.refunded}`;
                return <ReceiptCard key={k} id={k} image={images[ik]} slot={!seen.has(k) && !!images[ik]} />;
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <RefundDialog inv={refundFor} onClose={() => setRefundFor(null)} onDone={refresh} />
    </div>
  );
}

function RefundDialog({ inv, onClose, onDone }: { inv: OnchainInvoice | null; onClose: () => void; onDone: () => void }) {
  const { cfg, signer } = useHisaab();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = inv ? inv.paid - inv.refunded : 0n;

  useEffect(() => {
    if (inv) {
      setAmount(usdt(inv.paid - inv.refunded).replace(/,/g, ""));
      setError(null);
    }
  }, [inv]);

  async function submit() {
    if (!inv || !cfg || !signer) return;
    setBusy(true);
    setError(null);
    try {
      await cfg.hisaab.refund(signer, inv.id, toUnits(amount));
      toast(`Refunded ${amount} USDT on #${inv.id}`);
      onDone();
      onClose();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!inv} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>Refund invoice #{inv?.id.toString()}</DialogTitle>
        <DialogDescription>
          The refund comes out of your wallet and goes back to the payer. After any refund this invoice can&apos;t take more payments; refund the rest and reissue if needed.
        </DialogDescription>
        <label className="grid gap-1.5">
          <span className="label">Amount (USDT) · up to {usdt(max)}</span>
          <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="num" inputMode="decimal" />
        </label>
        {error && <p className="text-[15px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy || !amount || !signer}>
            {busy ? "Refunding…" : "Refund"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
