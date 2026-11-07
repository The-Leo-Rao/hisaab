"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, FileDown, Fuel, KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { zeroAddress } from "viem";
import {
  decodeFragment,
  keyFromFragment,
  docHash,
  explainError,
  isPayable,
  remaining,
  signGaslessPayment,
  submitToRelay,
  type InvoiceDoc,
  type OnchainInvoice,
  type PaymentEvent,
} from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { downloadSealedPdf } from "@/lib/sealed";
import { saveDoc, saveKey } from "@/lib/store";
import { dur, ease } from "@/lib/motion";
import { longDate, middle, same, usdt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/Amount";
import { GaslessBeam, type BeamPhase } from "@/components/GaslessBeam";
import { Hash } from "@/components/Hash";
import { IdentityChip } from "@/components/IdentityChip";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { ReceiptCard } from "@/components/ReceiptCard";
import { Stamp } from "@/components/Stamp";
import { StatusBadge } from "@/components/StatusBadge";
import { TxProgress, type Step } from "@/components/TxProgress";

type Data = { inv: OnchainInvoice; overdue: boolean; payments: PaymentEvent[] };
type Done = { txHash: string; gasless: boolean };

const first = (s?: string) => (s ? s.split(/\s+/)[0] : undefined);

export function PayView({ id }: { id: string }) {
  const { cfg, signer, me, tick, refresh, txUrl } = useHisaab();
  const [doc, setDoc] = useState<InvoiceDoc | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<BeamPhase>("idle");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const busy = phase === "signing" || phase === "relaying" || phase === "mined" || steps?.some((s) => s.state === "active");

  useEffect(() => {
    setHash(window.location.hash);
    setKey(keyFromFragment(window.location.hash));
    decodeFragment(window.location.hash).then(
      (d) => (setDoc(d), setDocErr(d ? null : "This link has no invoice document attached (the part after # is missing).")),
      () => setDocErr("The invoice in this link couldn't be read. Ask the issuer to send the link again."),
    );
  }, [id]);

  const load = useCallback(async () => {
    if (!cfg) return;
    try {
      const inv = await cfg.hisaab.getInvoice(BigInt(id));
      if (!inv) return setLoadErr(`Invoice #${id} doesn't exist on this registry.`);
      const [overdue, payments] = await Promise.all([cfg.hisaab.isOverdue(inv.id), cfg.hisaab.payments(inv.id)]);
      setData({ inv, overdue, payments });
      setLoadErr(null);
    } catch (e) {
      setLoadErr(explainError(e));
    }
  }, [cfg, id]);

  useEffect(() => {
    load();
  }, [load, tick]);

  useEffect(() => {
    if (!done || !cfg) return;
    let live = true;
    cfg.hisaab.receiptImage(BigInt(id)).then((img) => live && setReceipt(img));
    return () => {
      live = false;
    };
  }, [done, cfg, id]);

  if (loadErr) return <p className="mx-auto max-w-[640px] rounded-md border border-bad/40 bg-bad-fill/10 p-4 text-bad">{loadErr}</p>;
  if (!data || !cfg) {
    return (
      <div className="mx-auto grid max-w-[640px] gap-4">
        <div className="skeleton h-10 w-56" />
        <div className="skeleton h-80 w-full" />
      </div>
    );
  }

  const { inv } = data;
  const hashOk = doc ? docHash(doc).toLowerCase() === inv.docHash.toLowerCase() : null;
  if (hashOk && doc) {
    saveDoc(inv.docHash, doc);
    if (key) saveKey(inv.docHash, key);
  }
  const left = remaining(inv);
  const payable = isPayable(inv) && hashOk === true;
  const allowed = !!me && (same(inv.client, zeroAddress) || same(inv.client, me)) && (same(inv.payer, zeroAddress) || same(inv.payer, me));
  const verifyHref = `/verify/${id}${hash}`;
  const issuerShort = first(doc?.supplier.legalName) ?? middle(inv.issuer);
  const payerShort = first(doc?.customer.legalName) ?? "You";

  async function gasless() {
    if (!signer || !cfg) return;
    setError(null);
    setSteps(null);
    try {
      setPhase("signing");
      const req = await signGaslessPayment(signer, { registry: cfg.registry, usdt: cfg.usdt, id: inv.id, amount: left });
      setPhase("relaying");
      const { txHash } = await submitToRelay("/api/relay", req);
      setDone({ txHash, gasless: true });
      await cfg.client.waitForTransactionReceipt({ hash: txHash });
      setPhase("mined");
      setTimeout(() => setPhase("done"), 950);
      refresh();
    } catch (e) {
      setPhase("idle");
      setDone(null);
      setError(explainError(e));
    }
  }

  async function wallet() {
    if (!signer || !cfg) return;
    setError(null);
    setPhase("idle");
    const s: Step[] = [
      { label: "Approve USDT", state: "active" },
      { label: `Pay ${usdt(left)} USDT`, state: "todo" },
      { label: "Confirmed", state: "todo" },
    ];
    setSteps([...s]);
    try {
      const approval = await cfg.hisaab.ensureAllowance(signer, left);
      s[0] = { ...s[0], state: "done", hash: approval?.transactionHash };
      s[1] = { ...s[1], state: "active" };
      setSteps([...s]);
      const r = await cfg.hisaab.pay(signer, inv.id, left);
      s[1] = { ...s[1], state: "done", hash: r.txHash };
      s[2] = { ...s[2], state: "done" };
      setSteps([...s]);
      setDone({ txHash: r.txHash, gasless: false });
      setPhase("done");
      refresh();
    } catch (e) {
      const i = s.findIndex((x) => x.state === "active");
      if (i >= 0) s[i] = { ...s[i], state: "error" };
      setSteps([...s]);
      setError(explainError(e));
    }
  }

  const paidNow = phase === "done" && done;

  return (
    <div className="mx-auto grid max-w-[640px] gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="num rounded-sm border border-rule bg-card px-2 py-1 text-sm">Invoice #{id}</span>
          <StatusBadge status={inv.status} refunded={inv.refunded} overdue={data.overdue} />
        </div>
        <h1 className="display mt-4">{paidNow ? <><em>Settled.</em></> : <>Pay {issuerShort}</>}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-ink-2">
          Issued by <IdentityChip name={(hashOk ? doc?.supplier.ens : undefined) ?? inv.issuerName} wallet={inv.issuer} />
        </div>
      </div>

      {hashOk === false && (
        <div className="flex gap-3 rounded-md border border-bad/50 bg-bad-fill/10 p-4 text-bad" role="alert">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <p>
            <b className="font-semibold">This document doesn&apos;t match invoice #{id} onchain. Don&apos;t pay.</b> Someone may have edited the link. Ask the issuer for a fresh one.
          </p>
        </div>
      )}
      {docErr && <p className="rounded-md border border-warn/40 bg-warn-fill/15 p-4 text-warn">{docErr}</p>}

      {doc && (
        <InvoiceSheet
          doc={doc}
          id={id}
          docHash={inv.docHash}
          collapsible
          stamp={paidNow ? (onLand) => <Stamp variant="paid" date={longDate(Math.floor(Date.now() / 1000)).toUpperCase()} onLand={onLand} className="scale-75 origin-top-right sm:scale-90" /> : undefined}
        />
      )}

      {!paidNow && payable && (
        <section className="grid gap-5 rounded-md border border-rule bg-card p-5 md:p-6">
          <div>
            <div className="label">{inv.paid > 0n ? "Remaining" : "Amount due"}</div>
            <Amount units={left} size="hero" />
            <div className="mt-1 text-sm text-ink-3">
              Due {longDate(inv.dueDate)}
              {inv.paid > 0n && <> · {usdt(inv.paid)} USDT already paid</>}
            </div>
          </div>
          {!allowed && (
            <p className="rounded-sm border border-warn/40 bg-warn-fill/15 p-3 text-[15px] text-warn">
              {!me
                ? "Connect the wallet that should pay this invoice."
                : !same(inv.payer, zeroAddress) && !same(inv.payer, me)
                  ? "This invoice is locked to the wallet that made the first payment."
                  : `Only ${(hashOk ? doc?.customer.ens : undefined) || inv.clientName || "the client"}'s wallet (${middle(inv.client)}) can pay this invoice.`}
            </p>
          )}
          <div className="grid gap-3">
            <Button onClick={gasless} disabled={!allowed || !signer || busy || !cfg.relayer} className="h-12 text-base">
              Pay without gas
              <span className="num ml-1 rounded-sm bg-paper/15 px-1.5 py-0.5 text-[12px]">0 gas</span>
            </Button>
            <Button variant="secondary" onClick={wallet} disabled={!allowed || !signer || busy} className="h-12">
              <Fuel /> Pay with wallet
            </Button>
          </div>
          <p className="text-sm text-ink-3">
            USDT goes straight to the issuer. हिsaab never holds funds. No gas: you sign once, our relayer submits it.
          </p>
          {error && !steps && (
            <p className="rounded-sm border border-bad/40 bg-bad-fill/10 p-3 text-[15px] text-bad" role="alert">
              {error}
            </p>
          )}
          {steps && <TxProgress steps={steps} error={error} />}
        </section>
      )}

      {(phase !== "idle" || (done && done.gasless)) && (
        <section className="rounded-md border border-rule bg-card px-4" aria-live="polite">
          <GaslessBeam phase={phase} payer={payerShort} issuer={issuerShort} />
          <p className="pb-4 text-center text-sm text-ink-3">
            {phase === "signing" && "Waiting for your signature…"}
            {phase === "relaying" && "Relayer is submitting the payment…"}
            {(phase === "mined" || phase === "done") && "One signature. Zero gas. Settled in one transaction."}
          </p>
        </section>
      )}

      {done && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease: ease.out }} className="grid gap-4">
          <div className="grid gap-2 rounded-md border border-ok/40 bg-ok-fill/10 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label text-ok">Transaction</span>
              <Hash value={done.txHash} href={txUrl(done.txHash)} />
            </div>
            {!done.gasless && steps && <TxProgress steps={steps} />}
            {phase === "done" && (
              <p className="text-[15px] text-ok">
                Receipt <span className="num">#{id}</span> minted. The verify page shows the payment to anyone, and who it was between only to someone holding the sealed PDF and its key.
              </p>
            )}
          </div>
          {phase === "done" && (
            <>
              <ReceiptCard id={id} image={receipt} slot />
              {key && doc && (
                <div className="grid gap-2 rounded-md border border-rule bg-card p-4">
                  <div className="label">For your accounts</div>
                  <p className="text-sm text-ink-2">Keep the sealed PDF and the invoice key. Your CA needs both; send them separately.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => downloadSealedPdf(id, doc, key).catch((e) => toast.error(e.message))}>
                      <FileDown /> Sealed PDF
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(key).then(() => toast("Invoice key copied"))}>
                      <KeyRound /> Copy key
                    </Button>
                  </div>
                </div>
              )}
              <Button asChild className="h-12">
                <Link href={verifyHref}>
                  Open verify page <ArrowRight />
                </Link>
              </Button>
            </>
          )}
        </motion.section>
      )}

      {!payable && !done && hashOk !== false && (
        <section className="grid gap-3 rounded-md border border-rule bg-card p-5">
          <p className="text-[15px] text-ink-2">
            {inv.status === "Paid"
              ? "This invoice is already paid in full."
              : inv.status === "Cancelled"
                ? "This invoice was cancelled. Nothing to pay."
                : inv.status === "Refunded"
                  ? "This invoice was refunded."
                  : inv.refunded > 0n
                    ? "A refund was made on this invoice, so it no longer takes payments. The issuer can refund the rest and reissue it."
                    : "This invoice can't be paid right now."}
          </p>
          <Button variant="secondary" asChild>
            <Link href={verifyHref}>See its verification</Link>
          </Button>
        </section>
      )}

      {data.payments.length > 0 && !paidNow && (
        <section>
          <h2 className="label mb-2">Payments so far</h2>
          {data.payments.map((p) => (
            <div key={p.txHash} className="flex items-center justify-between border-b border-rule py-2 text-sm">
              <Amount units={p.amount} size="sm" />
              <Hash value={p.txHash} href={txUrl(p.txHash)} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
