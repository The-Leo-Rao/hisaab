"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Copy, ExternalLink, FileDown, KeyRound, Plus, Repeat2, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { isAddress, type Address } from "viem";
import { toast } from "sonner";
import { buildInvoice, docHash, explainError, formatMoney, lineAmount, payLink, randomSalt, totalUnits, type InvoiceDoc } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { downloadSealedPdf, nameSaltFor, newKey } from "@/lib/sealed";
import { loadNameSalt, saveDoc, saveTemplate, loadTemplate } from "@/lib/store";
import { group, same } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Hash } from "@/components/Hash";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { TxProgress, type Step } from "@/components/TxProgress";

type Mode = "freelance" | "contractor";
type LineIn = { description: string; qty: string; unitPrice: string };
type Form = {
  issuerName: string;
  supplierName: string;
  customerName: string;
  clientName: string;
  client: string;
  open: boolean;
  invoiceNumber: string;
  dueDays: string;
  lines: LineIn[];
  employer: string;
  role: string;
  periodFrom: string;
  periodTo: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
const monthName = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function monthBounds(d = new Date()) {
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function bumpNumber(n: string): string {
  const m = n.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return `${n}-2`;
  return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, "0")}${m[3]}`;
}

function repeat(mode: Mode, prev: Form): Form {
  const f = { ...prev, invoiceNumber: bumpNumber(prev.invoiceNumber), lines: prev.lines.map((l) => ({ ...l })) };
  if (mode === "contractor" && prev.periodFrom) {
    const d = new Date(prev.periodFrom);
    const p = monthBounds(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    const oldLabel = monthName(prev.periodFrom);
    f.periodFrom = p.from;
    f.periodTo = p.to;
    f.invoiceNumber = prev.invoiceNumber.replace(prev.periodFrom.slice(0, 7), p.from.slice(0, 7));
    if (f.invoiceNumber === prev.invoiceNumber) f.invoiceNumber = bumpNumber(prev.invoiceNumber);
    f.lines = f.lines.map((l) => ({ ...l, description: l.description.replace(oldLabel, monthName(p.from)) }));
  }
  return f;
}

type Ctx = ReturnType<typeof useHisaab>;

function defaults(mode: Mode, ctx: Ctx): Form {
  const { identity, cfg } = ctx;
  const company = cfg?.identities.find((i) => i.persona === "company");
  const handle = (identity?.label ?? "inv").slice(0, 3).toUpperCase();
  const base = {
    supplierName: identity?.legalName ?? "",
    customerName: company?.legalName ?? "",
    clientName: company?.ens ?? "",
    client: company?.address ?? "",
    open: false,
    dueDays: mode === "contractor" ? "7" : "14",
  };
  if (mode === "contractor") {
    const p = monthBounds();
    return {
      ...base,
      issuerName: identity?.persona === "contractor" ? identity.ens ?? "" : "",
      invoiceNumber: `${handle}/${p.from.slice(0, 7)}/001`,
      lines: [{ description: `Contract services, ${monthName(p.from)}`, qty: "160", unitPrice: "12.50" }],
      employer: company?.ens ?? "",
      role: identity?.persona === "contractor" ? (identity.key === "priya" ? "Product Designer, contract" : "QA Engineer, contract") : "",
      periodFrom: p.from,
      periodTo: p.to,
    };
  }
  return {
    ...base,
    issuerName: identity?.persona === "freelancer" ? identity.ens ?? "" : "",
    invoiceNumber: `${handle}/2026-27/0001`,
    lines: [
      { description: "Landing page development", qty: "1", unitPrice: "400.00" },
      { description: "Two revision rounds", qty: "2", unitPrice: "50.00" },
    ],
    employer: "",
    role: "",
    periodFrom: "",
    periodTo: "",
  };
}

type Created = { id: bigint; link: string; hash: string; txHash: string; doc: InvoiceDoc; key: string };

function Printed({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <div>
      <div aria-hidden className="h-2 rounded-full bg-ink" />
      <div className="-mt-1 overflow-hidden px-2 pt-1">
        <motion.div
          initial={reduced ? false : { clipPath: "inset(0 0 100% 0)", y: -24 }}
          animate={{ clipPath: "inset(0 0 0% 0)", y: 0 }}
          transition={{ duration: 0.9, ease: (t: number) => Math.min(1, Math.ceil(t * 3) / 3) }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}

export function CreateView() {
  const ctx = useHisaab();
  const { cfg, signer, me, identity, refresh } = ctx;
  const [mode, setMode] = useState<Mode>("freelance");
  const [f, setF] = useState<Form>(() => defaults("freelance", ctx));
  const [salt, setSalt] = useState(() => randomSalt());
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    if (identity?.persona === "contractor") setMode("contractor");
    if (identity?.persona === "freelancer") setMode("freelance");
  }, [identity?.key, identity?.persona]);

  useEffect(() => {
    setF(defaults(mode, ctx));
    setCreated(null);
    setSteps(null);
    setError(null);
  }, [mode, identity?.key, cfg]);

  const last = me ? loadTemplate<Form>(me, mode) : null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (i: number, k: keyof LineIn, v: string) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  const draft = useMemo(() => {
    if (!cfg) return { doc: null, err: "Loading…" };
    try {
      const issueDate = today();
      const days = Math.max(1, Number(f.dueDays) || 1);
      const client = !f.open && isAddress(f.client) ? (f.client as Address) : undefined;
      const nameSalt = me && f.issuerName ? loadNameSalt(me, f.issuerName) : null;
      const doc = buildInvoice({
        invoiceNumber: f.invoiceNumber,
        issueDate,
        dueDate: addDays(issueDate, days),
        supplier: { legalName: f.supplierName, ens: f.issuerName || undefined, wallet: me ?? undefined, ...(nameSalt ? { nameSalt } : {}) },
        customer: { legalName: f.customerName, ens: f.clientName || undefined, wallet: client },
        lines: f.lines.map((l) => ({ description: l.description, qty: Number(l.qty), unitPrice: l.unitPrice || "0" })),
        settlement: { chainId: cfg.chainId, registry: cfg.registry, token: cfg.usdt },
        engagement:
          mode === "contractor"
            ? { kind: "contract-employee", employer: f.employer, role: f.role, periodFrom: f.periodFrom, periodTo: f.periodTo }
            : { kind: "freelance" },
        salt,
      });
      return { doc, err: null };
    } catch (e) {
      return { doc: null, err: e instanceof Error ? e.message : String(e) };
    }
  }, [cfg, f, me, mode, salt]);

  const hash = draft.doc ? docHash(draft.doc) : null;
  const issues: string[] = [];
  if (!f.issuerName.endsWith(".eth")) issues.push(mode === "contractor" ? "Add the ENS name your company gave you." : "Add your engagement ENS name.");
  if (!f.open && !isAddress(f.client)) issues.push("Add the client's wallet address, or choose “anyone with the link”.");
  if (mode === "contractor" && f.open) issues.push("Contractor invoices must name the company wallet.");
  if (draft.err) issues.push(draft.err === "qty must be a positive integer" ? "Quantities must be whole numbers above zero." : draft.err);
  if (me && !f.open && same(f.client, me)) issues.push("You can't name yourself as the client.");

  async function submit() {
    if (!cfg || !signer || !me || !draft.doc || !hash) return;
    setError(null);
    const s: Step[] = [
      { label: "Sign your name secret (it stays in this browser)", state: "active" },
      { label: "Record the sealed invoice on Whitechain", state: "todo" },
    ];
    setSteps([...s]);
    let i = 0;
    try {
      const nameSalt = await nameSaltFor(signer, f.issuerName);
      const doc: InvoiceDoc = { ...draft.doc, supplier: { ...draft.doc.supplier, nameSalt } };
      const sealedHash = docHash(doc);
      s[0] = { ...s[0], state: "done" };
      s[1] = { ...s[1], state: "active" };
      setSteps([...s]);
      i = 1;
      const days = Math.max(1, Number(f.dueDays) || 1);
      const r = await cfg.hisaab.createInvoice(signer, {
        client: f.open ? undefined : (f.client as Address),
        amount: totalUnits(doc),
        dueDate: BigInt(Math.floor(Date.now() / 1000) + days * 86_400),
        docHash: sealedHash,
        issuerName: f.issuerName,
        clientName: f.clientName,
        salt: doc.salt,
      });
      s[1] = { ...s[1], state: "done", hash: r.txHash };
      setSteps([...s]);
      saveDoc(sealedHash, doc);
      saveTemplate(me, mode, f);
      const key = newKey(r.id, sealedHash);
      setCreated({ id: r.id, link: await payLink(window.location.origin, r.id, doc, key), hash: sealedHash, txHash: r.txHash, doc, key });
      setSalt(randomSalt());
      refresh();
    } catch (e) {
      s[i] = { ...s[i], state: "error" };
      setSteps([...s]);
      setError(explainError(e));
    }
  }

  const amount = useMemo(() => {
    try {
      return formatMoney(f.lines.reduce((sum, l) => sum + lineAmount(Number(l.qty), l.unitPrice || "0"), 0n));
    } catch {
      return null;
    }
  }, [f.lines]);

  if (created) {
    const path = new URL(created.link);
    return (
      <div className="mx-auto grid max-w-[720px] gap-6">
        <PageTitle title={<>Invoice <em>recorded</em></>} sub={`#${created.id} is on Whitechain. Send the link to your client however you like.`} />
        <Printed>
          <InvoiceSheet doc={created.doc} id={created.id} docHash={created.hash} />
        </Printed>
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.22 }} className="grid gap-4 rounded-md border border-rule bg-card p-5">
          <div>
            <div className="label mb-1">Pay link</div>
            <p className="num rounded-sm bg-paper-2/70 p-3 text-[13px] break-all text-ink-2">{created.link}</p>
            <p className="mt-2 text-sm text-ink-3">Everything after # stays in the browser. It never reaches a server. The link carries the invoice and its key, so send it only to your client.</p>
          </div>
          <div>
            <div className="label mb-1">Invoice key</div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="num rounded-sm bg-paper-2/70 px-3 py-2 text-[15px] tracking-wide break-all text-ink">{created.key}</p>
              <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(created.key).then(() => toast("Invoice key copied"))}>
                <KeyRound /> Copy key
              </Button>
            </div>
            <p className="mt-2 text-sm text-ink-3">
              Onchain, this invoice shows an amount and a status, nothing about who it is between. To prove it to a CA or a bank, send the sealed PDF and this key separately. Either one alone reveals nothing. Hisaab doesn&apos;t keep a copy.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button onClick={() => navigator.clipboard.writeText(created.link).then(() => toast("Pay link copied"))}>
              <Copy /> Copy pay link
            </Button>
            <Button variant="secondary" asChild>
              <Link href={path.pathname + path.hash}>
                <ExternalLink /> Open pay page
              </Link>
            </Button>
            <Button
              variant="secondary"
              onClick={() => downloadSealedPdf(created.id, created.doc, created.key).catch((e) => toast.error(e.message))}
            >
              <FileDown /> Download sealed PDF
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`/verify/${created.id}`}>
                <ShieldCheck /> Verify page
              </Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            Transaction <Hash value={created.txHash} href={ctx.txUrl(created.txHash)} />
          </div>
        </motion.section>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={() => setCreated(null)}>
            Create another
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/invoices">My invoices</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title={<>New <em>invoice</em></>}
        sub="Only a fingerprint goes onchain, with no names. The document travels with the link, sealed by a key only you hand out."
        right={
          last ? (
            <Button variant="secondary" onClick={() => setF(repeat(mode, last))}>
              <Repeat2 /> Repeat last invoice
            </Button>
          ) : undefined
        }
      />
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mb-8">
        <TabsList>
          <TabsTrigger value="freelance">Freelancer</TabsTrigger>
          <TabsTrigger value="contractor">Contractor → company</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <form
          className="grid content-start gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!issues.length) submit();
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={mode === "contractor" ? "Your ENS name (from the company)" : "Your engagement ENS name"} hint={mode === "contractor" ? "e.g. priya.dev.acme-labs.eth" : "e.g. acme-q4.ravi-dev.eth"}>
              <Input value={f.issuerName} onChange={(e) => set("issuerName", e.target.value.trim())} className="num" />
            </Field>
            <Field label="Your legal name">
              <Input value={f.supplierName} onChange={(e) => set("supplierName", e.target.value)} />
            </Field>
            <Field label="Invoice number">
              <Input value={f.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} className="num" />
            </Field>
            <Field label="Due in (days)">
              <Input inputMode="numeric" value={f.dueDays} onChange={(e) => set("dueDays", e.target.value.replace(/\D/g, ""))} className="num" />
            </Field>
          </div>

          <fieldset className="grid gap-4 border-t border-rule pt-5">
            <legend className="label mb-3">{mode === "contractor" ? "Company" : "Client"}</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Client legal name">
                <Input value={f.customerName} onChange={(e) => set("customerName", e.target.value)} />
              </Field>
              <Field label="Client ENS name">
                <Input value={f.clientName} onChange={(e) => set("clientName", e.target.value.trim())} className="num" />
              </Field>
            </div>
            {!f.open && (
              <Field label="Client wallet (only this wallet can pay)">
                <Input value={f.client} onChange={(e) => set("client", e.target.value.trim())} className="num" placeholder="0x…" aria-invalid={!!f.client && !isAddress(f.client)} />
              </Field>
            )}
            {cfg?.local && !f.open && (
              <div className="flex flex-wrap gap-2">
                {cfg.identities
                  .filter((i) => !same(i.address, me))
                  .map((i) => (
                    <button
                      type="button"
                      key={i.key}
                      onClick={() => setF((x) => ({ ...x, client: i.address, clientName: i.ens ?? "", customerName: i.legalName }))}
                      className={cn("rounded-sm border px-2.5 py-1 text-sm", same(f.client, i.address) ? "border-ink bg-ink text-paper" : "border-rule-strong text-ink-2 hover:bg-paper-2")}
                    >
                      {i.label}
                    </button>
                  ))}
              </div>
            )}
            {mode === "freelance" && (
              <label className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" checked={f.open} onChange={(e) => set("open", e.target.checked)} className="size-4 accent-[#14213d]" />
                Anyone with the link may pay
              </label>
            )}
            {f.open && (
              <p className="flex gap-2 rounded-sm border border-warn/40 bg-warn-fill/15 p-3 text-sm text-warn">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                The first wallet that pays becomes the only payer. A stranger with the link could pay a tiny amount first and lock it; you&apos;d then refund it and reissue. Name the client when you can.
              </p>
            )}
          </fieldset>

          {mode === "contractor" && (
            <fieldset className="grid gap-5 border-t border-rule pt-5 sm:grid-cols-2">
              <legend className="label mb-3">Engagement</legend>
              <Field label="Employer (ENS)">
                <Input value={f.employer} onChange={(e) => set("employer", e.target.value.trim())} className="num" />
              </Field>
              <Field label="Role">
                <Input value={f.role} onChange={(e) => set("role", e.target.value)} />
              </Field>
              <Field label="Period from">
                <Input type="date" value={f.periodFrom} onChange={(e) => set("periodFrom", e.target.value)} />
              </Field>
              <Field label="Period to">
                <Input type="date" value={f.periodTo} onChange={(e) => set("periodTo", e.target.value)} />
              </Field>
            </fieldset>
          )}

          <fieldset className="border-t border-rule pt-5">
            <legend className="label mb-3">{mode === "contractor" ? "Hours × rate" : "Line items"}</legend>
            <div className="grid gap-3">
              {f.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_72px_96px_36px] items-end gap-2">
                  <Field label={i === 0 ? "Description" : ""}>
                    <Input value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} aria-label="Description" />
                  </Field>
                  <Field label={i === 0 ? (mode === "contractor" ? "Hours" : "Qty") : ""}>
                    <Input inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value.replace(/\D/g, ""))} className="num text-right" aria-label="Quantity" />
                  </Field>
                  <Field label={i === 0 ? (mode === "contractor" ? "Rate" : "Unit") : ""}>
                    <Input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value.replace(/[^\d.]/g, ""))} className="num text-right" aria-label="Unit price in USDT" />
                  </Field>
                  <Button type="button" variant="ghost" size="icon" className="mb-1" disabled={f.lines.length === 1} onClick={() => set("lines", f.lines.filter((_, j) => j !== i))} aria-label="Remove line">
                    <X />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={() => set("lines", [...f.lines, { description: "", qty: "1", unitPrice: "" }])}>
                <Plus /> Add line
              </Button>
              <span className="num text-lg">
                {amount ? group(amount) : "—"} <span className="font-sans text-sm text-ink-3">USDT</span>
              </span>
            </div>
          </fieldset>

          <div className="grid gap-3 border-t border-rule pt-5">
            {issues.length > 0 && (
              <ul className="grid gap-1 text-sm text-warn">
                {issues.map((x) => (
                  <li key={x}>· {x}</li>
                ))}
              </ul>
            )}
            {!signer && <p className="text-sm text-warn">Connect a wallet to create invoices.</p>}
            <Button type="submit" className="h-12 text-base" disabled={!!issues.length || !signer || steps?.[0]?.state === "active"}>
              Create invoice
            </Button>
            {steps && <TxProgress steps={steps} error={error} />}
          </div>
        </form>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="label mb-3">Live preview</div>
          {draft.doc ? (
            <InvoiceSheet doc={draft.doc} />
          ) : (
            <div className="grid aspect-[4/5] place-items-center rounded-md border border-dashed border-rule-strong p-8 text-center text-ink-3">Fill in the form to see the invoice.</div>
          )}
          <div className="mt-4 rounded-sm border border-rule bg-card p-3">
            <div className="label">Document hash</div>
            <div className="num mt-1 text-[13px] break-all text-ink">{hash ?? "—"}</div>
            <p className="mt-1 text-sm text-ink-3">This hash goes onchain. The document doesn&apos;t.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
