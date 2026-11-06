"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { FileDown, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, downloadPdf, type VerifyResult } from "@/lib/api";
import { useHisaab } from "@/lib/hisaab";
import { dur, stagger, useHero } from "@/lib/motion";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/Amount";
import { CheckRow } from "@/components/CheckRow";
import { Hash } from "@/components/Hash";
import { InvoiceSheet, type SheetDoc } from "@/components/InvoiceSheet";
import { PdfDropZone } from "@/components/PdfDropZone";
import { ReceiptCard } from "@/components/ReceiptCard";
import { Stamp } from "@/components/Stamp";
import { fromTone } from "@/components/tone";

type Found = Extract<VerifyResult, { exists: true }>;
type Verdict = { headline: React.ReactNode; text: string; stamp: { variant: "verified" | "paid" | "void"; label?: string } | null; tone: "ok" | "warn" | "bad" };

const CODES: Record<string, string> = { hash: "A", issuer: "B", standing: "C", payment: "D", client: "·" };
const TITLES: Record<string, string> = { hash: "Document", issuer: "Issuer", standing: "Standing", payment: "Payment", client: "Client" };

function verdictOf(r: Found): Verdict {
  const t = Object.fromEntries(r.checks.map((c) => [c.key, c.tone]));
  if (r.verified) return { headline: <em>Verified</em>, text: r.summary ?? "", stamp: { variant: "verified" }, tone: "ok" };
  const anyRed = r.checks.some((c) => c.tone === "red");
  if (!anyRed && t.hash === "grey" && t.issuer === "green" && t.payment === "green") {
    return {
      headline: (
        <>
          Paid <em>onchain</em>
        </>
      ),
      text: "The issuer and the payment check out onchain. Open the pay link or drop the PDF below to check the document itself.",
      stamp: { variant: "paid" },
      tone: "ok",
    };
  }
  if (anyRed) {
    return {
      headline: "Not verified",
      text: "At least one check failed. Read each row below before relying on this invoice.",
      stamp: { variant: "void", label: "NOT VERIFIED" },
      tone: "bad",
    };
  }
  return { headline: "Check the details", text: "Nothing failed, but some rows need a closer look. Read each row below.", stamp: null, tone: "warn" };
}

export function VerifyView({ id }: { id: string }) {
  const { txUrl } = useHisaab();
  const reduced = useReducedMotion();
  const hero = useHero();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<SheetDoc | null>(null);
  const [fragment, setFragment] = useState<string | null>(null);
  const [first, setFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const docRef = useRef<unknown>(null);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setBusy(true);
      try {
        const frag = typeof window !== "undefined" && window.location.hash.includes("d=") ? window.location.hash : null;
        const r = docRef.current
          ? await api.verifyWith({ id, document: docRef.current })
          : frag
            ? await api.verifyWith({ id, fragment: frag })
            : await api.verify(id);
        if (r.exists && r.document && !docRef.current) {
          docRef.current = r.document;
          setDocument(r.document as SheetDoc);
        }
        setFragment(frag);
        setResult(r);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  useEffect(() => {
    docRef.current = null;
    setDocument(null);
    try {
      const dropped = sessionStorage.getItem(`hisaab:drop:${id}`);
      if (dropped) {
        docRef.current = JSON.parse(dropped);
        setDocument(docRef.current as SheetDoc);
        sessionStorage.removeItem(`hisaab:drop:${id}`);
      }
    } catch {}
    setResult(null);
    setFirst(true);
    load();
  }, [id, load]);

  useEffect(() => {
    const onHash = () => {
      docRef.current = null;
      setDocument(null);
      setResult(null);
      setFirst(true);
      load();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [load]);

  useEffect(() => {
    if (!result || !first) return;
    const t = setTimeout(() => setFirst(false), 4000);
    return () => clearTimeout(t);
  }, [result, first]);

  const found = result?.exists ? result : null;
  const verdict = useMemo(() => (found ? verdictOf(found) : null), [found]);
  const step = reduced ? 0 : stagger.checks * hero;
  const delayOf = (i: number) => (first ? 0.25 + i * step : 0);
  const stampDelay = reduced ? 0 : first ? delayOf(3) + dur.base * hero : 0;
  const paidOn = found ? longDate(found.invoice.paidAt) : "";

  if (error && !result) {
    return (
      <div className="mx-auto max-w-[640px]">
        <p className="rounded-md border border-bad/40 bg-bad-fill/10 p-4 text-bad" role="alert">
          {error}
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => load()}>
          Try again
        </Button>
      </div>
    );
  }

  if (result && !result.exists) {
    return (
      <div className="mx-auto max-w-[640px]">
        <h1 className="display">No invoice #{id}</h1>
        <p className="mt-3 text-ink-2">Invoice #{id} doesn't exist on this registry. Check the number on the document or scan its QR code again.</p>
        <Link href="/verify" className="mt-6 inline-block underline underline-offset-4">
          Look up another invoice
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-[640px] gap-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num rounded-sm border border-rule bg-card px-2 py-1 text-sm">Invoice #{id}</span>
        <span className="num rounded-sm border border-rule px-2 py-1 text-[11px] tracking-[0.08em] text-ink-3">
          WHITECHAIN · {found?.chain.chainId ?? 1874}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => load()} disabled={busy} aria-label="Re-check now">
          <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Re-check
        </Button>
      </div>

      <section className="relative overflow-hidden rounded-md border border-rule bg-card px-5 pt-6 pb-6 md:px-8" aria-live="polite">
        {found && verdict ? (
          <>
            <div className="pr-0 sm:pr-44">
              <motion.h1
                key={String(found.verified) + verdict.tone}
                className="display"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: first ? stampDelay * 0.85 : 0, duration: dur.short }}
              >
                {verdict.headline}
              </motion.h1>
              <motion.p className="mt-3 text-[17px] leading-7 text-ink-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: first ? stampDelay * 0.85 : 0 }}>
                {verdict.text}
              </motion.p>
            </div>
            {verdict.stamp && (
              <div className="mt-5 flex justify-end sm:absolute sm:top-6 sm:right-5 sm:mt-0">
                <Stamp
                  key={`${verdict.stamp.variant}-${verdict.stamp.label ?? ""}`}
                  variant={verdict.stamp.variant}
                  label={verdict.stamp.label}
                  date={found.invoice.paidAt !== "0" ? paidOn.toUpperCase() : undefined}
                  ariaLabel={`${verdict.stamp.label ?? (verdict.stamp.variant === "paid" ? "Paid" : "Verified")}${found.invoice.paidAt !== "0" ? ` on ${paidOn}` : ""}`}
                  delay={stampDelay}
                  className="scale-90 sm:scale-100"
                />
              </div>
            )}
          </>
        ) : (
          <div className="grid gap-3">
            <div className="skeleton h-12 w-48" />
            <div className="skeleton h-5 w-full" />
            <div className="skeleton h-5 w-2/3" />
          </div>
        )}
      </section>

      <section aria-label="Checks">
        <div className="mb-1 flex items-end justify-between border-b border-rule-strong pb-2">
          <span className="label">Check</span>
          <span className="label">Result</span>
        </div>
        {(found?.checks ?? ["hash", "issuer", "standing", "payment", "client"].map((key) => ({ key, label: "", tone: "grey" as const, text: "", evidence: {} }))).map((c, i) => (
          <CheckRow
            key={c.key}
            code={CODES[c.key]}
            title={TITLES[c.key]}
            state={fromTone(c.tone)}
            detail={c.text}
            evidence={c.evidence}
            resolved={!!found}
            delay={delayOf(i)}
          />
        ))}
        <p className="mt-3 text-sm text-ink-3">Verified means A, B and D pass. Standing and Client add context from ENS.</p>
      </section>

      {found && (
        <section aria-label="Receipt">
          {found.receipt.exists ? (
            <ReceiptCard id={id} image={found.receipt.image} />
          ) : (
            <p className="rounded-md border border-rule bg-paper-2/60 p-4 text-[15px] text-ink-2">
              No receipt NFT. One is recorded to the issuer only when the invoice is paid in full, and it is burned on a full refund.
            </p>
          )}
        </section>
      )}

      {found &&
        (document ? (
          <InvoiceSheet doc={document} id={id} docHash={found.invoice.docHash} collapsible />
        ) : (
          <p className="flex gap-3 rounded-md border border-warn/40 bg-warn-fill/15 p-4 text-[15px] text-warn">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" />
            <span>
              <b className="font-semibold">Verified onchain · document not attached.</b> Open the full pay link or drop the invoice PDF below to compare the document with
              its onchain fingerprint.
            </span>
          </p>
        ))}

      {found && (
        <section aria-label="Payments">
          <h2 className="title mb-3">Payments on Whitechain</h2>
          {found.payments.length === 0 ? (
            <p className="text-ink-3">No payments yet.</p>
          ) : (
            <div className="border-t border-rule-strong">
              {found.payments.map((p) => (
                <div key={p.txHash} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-rule py-3">
                  <Amount units={p.amount} />
                  <span className="label rounded-sm border border-rule px-1.5 py-0.5 text-right">{p.gasless ? "Gasless" : "Wallet"}</span>
                  <span className="text-sm text-ink-3">
                    from <Hash value={p.payer} />
                  </span>
                  <Hash value={p.txHash} href={txUrl(p.txHash)} className="justify-self-end text-sm" />
                </div>
              ))}
              {found.refunds.map((r) => (
                <div key={r.txHash} className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b border-rule py-3 text-warn">
                  <span>
                    Refund <Amount units={r.amount} className="text-warn" />
                  </span>
                  <Hash value={r.txHash} href={txUrl(r.txHash)} className="text-sm" />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {found && (
        <section className="grid gap-4" aria-label="Documents">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={() =>
                downloadPdf("/statement", { id, document: docRef.current ?? undefined }, `hisaab-statement-${id}.pdf`).catch((e) => toast.error(e.message))
              }
            >
              <FileDown /> Download Hisaab Statement (PDF)
            </Button>
            {document && (
              <Button variant="secondary" onClick={() => downloadPdf("/invoice-pdf", { id, document: docRef.current ?? undefined }, `invoice-${id}.pdf`).catch((e) => toast.error(e.message))}>
                Invoice PDF
              </Button>
            )}
          </div>
          <PdfDropZone
            id={id}
            onResult={(r) => {
              if (r.exists && r.document) {
                docRef.current = r.document;
                setDocument(r.document as SheetDoc);
              }
              setFirst(true);
              setResult(null);
              requestAnimationFrame(() => setResult(r));
              toast(r.exists ? "PDF checked against the chain" : "That PDF points to an invoice that doesn't exist");
            }}
          />
          {fragment && <p className="text-sm text-ink-3">The document came from the link (after #). It never left this browser except for this check.</p>}
        </section>
      )}
    </div>
  );
}
