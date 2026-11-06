"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ArrowRight, FileCheck2, Fingerprint, Send } from "lucide-react";
import type { OnchainInvoice } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { dur, ease, useHero } from "@/lib/motion";
import { longDate, middle, usdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GaslessBeam, type BeamPhase } from "@/components/GaslessBeam";
import { Hash } from "@/components/Hash";
import { useEnsName } from "@/components/IdentityChip";
import { Stamp } from "@/components/Stamp";

function useLatestPaid() {
  const { cfg } = useHisaab();
  const [inv, setInv] = useState<OnchainInvoice | null | undefined>(undefined);
  useEffect(() => {
    if (!cfg) return;
    let live = true;
    (async () => {
      const next = await cfg.hisaab.nextId();
      for (let id = next - 1n; id > 0n && id >= next - 25n; id--) {
        const i = await cfg.hisaab.getInvoice(id);
        if (i?.status === "Paid") return live && setInv(i);
      }
      if (live) setInv(null);
    })().catch(() => live && setInv(null));
    return () => {
      live = false;
    };
  }, [cfg]);
  return inv;
}

function MiniSheet({ inv }: { inv: OnchainInvoice | null | undefined }) {
  const hero = useHero();
  const [scope, setScope] = useState(0);
  if (inv === undefined) return <div className="skeleton aspect-[5/4] w-full rounded-md" />;
  if (inv === null) {
    return (
      <div className="grid aspect-[5/4] w-full place-items-center rounded-md border border-dashed border-rule-strong bg-card/60 p-8 text-center text-ink-3">
        The first paid invoice on this registry will show up here.
      </div>
    );
  }
  return (
    <motion.article
      key={scope}
      animate={scope ? { y: [0, 2, 0] } : undefined}
      transition={{ duration: 0.18 }}
      className="relative overflow-hidden rounded-md border border-rule bg-card shadow-[var(--shadow-sheet)]"
      aria-label={`Invoice ${inv.id.toString()}, paid`}
    >
      <span aria-hidden className="absolute inset-y-0 left-6 w-[2px] bg-bad-fill/20" />
      <div className="py-7 pr-6 pl-11">
        <div className="label">Invoice · onchain record</div>
        <div className="num mt-1 text-ink-2">#{inv.id.toString()}</div>
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-rule pt-4 text-sm">
          <div>
            <div className="label">From</div>
            <div className="num truncate">{inv.issuerName || "Sealed"}</div>
          </div>
          <div>
            <div className="label">To</div>
            <div className="num truncate">{inv.clientName || (inv.issuerName ? middle(inv.client) : "Sealed")}</div>
          </div>
        </div>
        <div className="mt-6 flex items-baseline justify-between border-t border-rule pt-4">
          <span className="label">Total</span>
          <span className="num text-[28px]">
            {usdt(inv.amount)} <span className="font-sans text-sm text-ink-3">USDT</span>
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-ink-3">
          <span>Document hash</span>
          <Hash value={inv.docHash} head={8} tail={6} copy={false} />
        </div>
      </div>
      <div className="absolute top-5 right-5">
        <Stamp variant="paid" date={longDate(inv.paidAt).toUpperCase()} delay={0.6 * hero} onLand={() => setScope(1)} className="origin-top-right scale-75" />
      </div>
    </motion.article>
  );
}

const STEPS = [
  { Icon: Fingerprint, title: "Issue", text: "A fingerprint of the invoice goes onchain, with no names. The document is sealed with a key that only you hand out." },
  { Icon: Send, title: "Get paid", text: "Your client pays in USDT without gas. The money goes straight to your wallet in one transaction. Hisaab never holds it." },
  { Icon: FileCheck2, title: "Prove it", text: "Give your CA the sealed PDF and its key. Anyone else who finds your wallet sees amounts, not who you work for." },
];

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 55%"] });
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <section ref={ref} className="border-t border-rule py-20">
      <div className="label mb-8">How it works</div>
      <div className="relative">
        <motion.div aria-hidden style={{ scaleX }} className="absolute top-0 left-0 hidden h-[2px] w-full origin-left bg-ink md:block" />
        <div className="grid gap-10 md:grid-cols-3 md:gap-0">
          {STEPS.map(({ Icon, title, text }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: dur.base, delay: i * 0.12, ease: ease.out }}
              className={cn("md:px-8 md:pt-8", i > 0 && "md:border-l md:border-rule", i === 0 && "md:pl-0")}
            >
              <div className="flex items-center gap-3">
                <span className="num text-sm text-ink-3">0{i + 1}</span>
                <Icon className="size-5" strokeWidth={1.6} />
              </div>
              <h3 className="mt-4 font-display text-[34px] leading-none">{title}</h3>
              <p className="mt-3 text-ink-2">{text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BeamSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const reduced = useReducedMotion();
  const hero = useHero();
  const [phase, setPhase] = useState<BeamPhase>("idle");
  useEffect(() => {
    if (!inView) return;
    if (reduced) return setPhase("done");
    const t = [
      setTimeout(() => setPhase("signing"), 0),
      setTimeout(() => setPhase("relaying"), 900 * hero),
      setTimeout(() => setPhase("mined"), 2700 * hero),
      setTimeout(() => setPhase("done"), 3700 * hero),
    ];
    return () => t.forEach(clearTimeout);
  }, [inView, reduced, hero]);
  return (
    <section ref={ref} className="border-t border-rule py-20">
      <div className="grid gap-10 md:grid-cols-[1fr_1.6fr] md:items-center">
        <div>
          <div className="label mb-4">Payments nobody notices</div>
          <h2 className="display">
            One signature. <em>Zero</em> gas.
          </h2>
          <p className="mt-4 text-ink-2">
            The client signs once. Our relayer submits the payment and pays the network fee. The registry checks the signature, records the payment and moves USDT straight to the issuer. Settled in one transaction.
          </p>
        </div>
        <div className="rounded-md border border-rule bg-card px-4">
          <GaslessBeam phase={phase} payer="Acme" issuer="Ravi" />
        </div>
      </div>
    </section>
  );
}

function TreeNode({ name, note }: { name: string; note: string }) {
  const [open, setOpen] = useState(false);
  const ens = useEnsName(open ? name : null);
  const records = Object.entries(ens?.records ?? {}).filter(([, v]) => v);
  return (
    <Tooltip onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button type="button" className="group flex w-full items-baseline justify-between gap-3 rounded-sm border border-rule-strong bg-card px-3 py-2 text-left hover:border-ink">
          <span className="num truncate text-[14px]">{name}</span>
          <span className="shrink-0 text-[12px] text-ink-3">{note}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[13px]">
        {!ens ? (
          "Reading ENS…"
        ) : (
          <div className="grid gap-1">
            <div>
              {ens.status}
              {ens.expiry ? ` · until ${longDate(ens.expiry)}` : ""}
            </div>
            {records.length === 0 && <div className="opacity-80">No hisaab.* records</div>}
            {records.map(([k, v]) => (
              <div key={k} className="num text-xs opacity-85">
                {k} = {String(v).length > 40 ? middle(String(v), 18, 10) : v}
              </div>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function Tree({ title, sub, nodes }: { title: string; sub: string; nodes: { name: string; note: string }[] }) {
  return (
    <div>
      <h3 className="title">{title}</h3>
      <p className="mt-1 text-sm text-ink-2">{sub}</p>
      <div className="mt-5 grid gap-0">
        {nodes.map((n, i) => (
          <div key={n.name} className="relative" style={{ paddingLeft: i * 24 }}>
            {i > 0 && <span aria-hidden className="absolute top-0 h-1/2 w-3 rounded-bl-sm border-b border-l border-ink/50" style={{ left: i * 24 - 14 }} />}
            <div className="py-1.5">
              <TreeNode {...n} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhoneShot() {
  return (
    <div className="mx-auto w-[260px] rounded-[36px] border border-ink/70 bg-ink p-2.5 shadow-[0_24px_60px_-30px_rgb(20_33_61/0.6)]">
      <div className="overflow-hidden rounded-[28px] bg-paper">
        <img src="/verify-phone.png" alt="The Hisaab verify page on a phone: Verified, with every check passing" className="block w-full" loading="lazy" />
      </div>
    </div>
  );
}

export function Landing() {
  const { cfg } = useHisaab();
  const inv = useLatestPaid();
  const [askId, setAskId] = useState(false);
  const [id, setId] = useState("");

  return (
    <div>
      <section className="grid items-center gap-12 pt-4 pb-20 md:grid-cols-[1.15fr_1fr] md:pt-10">
        <div>
          <h1 className="display-xl">
            Invoices that <em>prove</em> themselves.
          </h1>
          <p className="mt-6 max-w-xl text-[18px] leading-8 text-ink-2">
            Bill clients in USDT on Whitechain. They pay without gas. Your CA or bank checks every payment from a QR code, without asking you for screenshots.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="h-12 px-6 text-base">
              <Link href="/create">
                Create an invoice <ArrowRight />
              </Link>
            </Button>
            {askId ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^\d+$/.test(id)) window.location.href = `/verify/${id}`;
                }}
              >
                <Input autoFocus inputMode="numeric" placeholder="Invoice #" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} className="num h-12 w-36" aria-label="Invoice number" />
                <Button type="submit" variant="secondary" className="h-12">
                  Verify
                </Button>
              </form>
            ) : (
              <Button variant="secondary" className="h-12 px-6 text-base" onClick={() => setAskId(true)}>
                Verify an invoice
              </Button>
            )}
          </div>
        </div>
        <MiniSheet inv={inv} />
      </section>

      <HowItWorks />
      <BeamSection />

      <section className="border-t border-rule py-20">
        <div className="label mb-4">Identity on ENS</div>
        <h2 className="display max-w-2xl">
          Names that <em>vouch</em> for the person billing you.
        </h2>
        <p className="mt-4 max-w-2xl text-ink-2">Every invoice names an ENS identity. Hover a name to read its live Hisaab records on ENSv2.</p>
        <div className="mt-10 grid gap-12 md:grid-cols-2">
          <Tree
            title="A company vouches for its contractors"
            sub="Issued by the company, expires when the contract ends, revocable on the spot."
            nodes={[
              { name: "acme-labs.eth", note: "company" },
              { name: "dev.acme-labs.eth", note: "team" },
              { name: "priya.dev.acme-labs.eth", note: "contractor" },
            ]}
          />
          <Tree
            title="A freelancer names each engagement"
            sub="One name per client. The client can acknowledge each invoice on it."
            nodes={[
              { name: "ravi-dev.eth", note: "freelancer" },
              { name: "acme-q4.ravi-dev.eth", note: "engagement" },
            ]}
          />
        </div>
      </section>

      <section className="border-t border-rule py-20">
        <div className="grid items-center gap-12 md:grid-cols-[1fr_auto]">
          <div>
            <div className="label mb-4">For CAs and banks</div>
            <h2 className="display max-w-xl">
              Scan the QR. Read the <em>ledger</em>.
            </h2>
            <ul className="mt-8 grid max-w-xl gap-0 border-t border-rule">
              {[
                ["A · Document", "The invoice matches the fingerprint recorded onchain."],
                ["B · Issuer", "The ENS name's sealed wallet record matches the wallet that issued it."],
                ["C · Standing", "The name was active, and vouched for by the company where relevant."],
                ["D · Payment", "The full amount arrived, and the receipt was minted."],
                ["Client", "The payer is the client named on the invoice."],
              ].map(([k, v]) => (
                <li key={k} className="grid grid-cols-[130px_1fr] gap-4 border-b border-rule py-3">
                  <span className="font-semibold">{k}</span>
                  <span className="text-ink-2">{v}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-3">No wallet needed. Without the key the page shows public facts only. Drop the sealed PDF, type the key, and every check runs in full.</p>
          </div>
          <PhoneShot />
        </div>
      </section>

      <footer className="grid gap-6 border-t border-rule pt-10 text-sm text-ink-2 md:grid-cols-3">
        <div>
          <div className="font-display text-2xl text-ink">Hisaab</div>
          <p className="mt-2">Built at ETHGlobal Mumbai 2026.</p>
        </div>
        <div className="grid gap-2">
          <div className="label">Contracts · Whitechain {cfg?.chainId ?? 1874}</div>
          {cfg ? (
            <>
              <div className="flex items-center gap-2">
                Registry <Hash value={cfg.registry} href={cfg.local ? undefined : `https://explorer.testnet.whitechain.io/address/${cfg.registry}`} />
              </div>
              <div className="flex items-center gap-2">
                Receipt <Hash value={cfg.receipt} href={cfg.local ? undefined : `https://explorer.testnet.whitechain.io/address/${cfg.receipt}`} />
              </div>
              {cfg.local && <span className="text-ink-3">Running on a local fork of Whitechain testnet.</span>}
            </>
          ) : (
            <span className="skeleton h-5 w-48" />
          )}
        </div>
        <div className="grid content-start gap-2">
          <div className="label">Source</div>
          <a href="https://github.com/The-Leo-Rao/hisaab" target="_blank" rel="noreferrer" className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            github.com/The-Leo-Rao/hisaab
          </a>
        </div>
      </footer>
    </div>
  );
}
