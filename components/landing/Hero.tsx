"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { registryAbi } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { dur, ease } from "@/lib/motion";
import { toNumber } from "@/lib/format";
import { NumberTicker } from "@/components/ui/number-ticker";
import { MetalCoin } from "./metal/MetalCoin";

type Stats = { invoices: number; settled: bigint; receipts: number; gasless: number };

function useRegistryStats() {
  const { cfg } = useHisaab();
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    if (!cfg) return;
    let live = true;
    (async () => {
      const next = await cfg.hisaab.nextId();
      const ids = Array.from({ length: Math.min(Number(next - 1n), 200) }, (_, i) => next - 1n - BigInt(i));
      const [list, paid] = await Promise.all([
        cfg.hisaab.many(ids),
        cfg.client.getContractEvents({ address: cfg.registry, abi: registryAbi, eventName: "Paid", fromBlock: cfg.deployBlock, toBlock: "latest" }),
      ]);
      if (!live) return;
      setStats({
        invoices: Number(next - 1n),
        settled: list.reduce((s, i) => s + i.paid - i.refunded, 0n),
        receipts: list.filter((i) => i.status === "Paid").length,
        gasless: paid.filter((l) => l.args.gasless).length,
      });
    })().catch(() => live && setStats(null));
    return () => {
      live = false;
    };
  }, [cfg]);
  return stats;
}

function Stat({ label, value, decimals = 0, unit }: { label: string; value: number | null; decimals?: number; unit?: string }) {
  return (
    <div className="px-5 py-5 md:px-7">
      <div className="text-[12px] tracking-[0.08em] text-paper/50 uppercase">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5 text-paper">
        {value === null ? <span className="h-8 w-20 animate-pulse rounded-sm bg-white/10" /> : <NumberTicker value={value} decimalPlaces={decimals} className="text-[26px] md:text-[32px]" />}
        {unit && value !== null && <span className="text-sm text-paper/50">{unit}</span>}
      </div>
    </div>
  );
}

export function Hero() {
  const { cfg } = useHisaab();
  const stats = useRegistryStats();
  const [askId, setAskId] = useState(false);
  const [id, setId] = useState("");
  const rise = (i: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: dur.long, delay: 0.1 + i * 0.12, ease: ease.out },
  });

  return (
    <section className="relative isolate overflow-hidden bg-[#060a12] text-paper">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="hero-glow absolute top-[-30%] right-[-10%] h-[90%] w-[70%] rounded-full bg-[radial-gradient(closest-side,rgb(18_165_148/0.28),transparent)] blur-2xl" />
        <div className="hero-glow absolute top-[20%] right-[18%] h-[60%] w-[45%] rounded-full bg-[radial-gradient(closest-side,rgb(201_164_106/0.18),transparent)] blur-2xl [animation-delay:-7.5s]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#060a12]" />
      </div>

      <div className="mx-auto grid max-w-[1120px] items-center gap-6 px-4 pt-14 md:min-h-[calc(100dvh-64px)] md:grid-cols-[1.05fr_1fr] md:px-6 md:pt-6">
        <div className="relative z-10">
          <motion.div {...rise(0)} className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[13px] text-paper/75">
            <span className="size-1.5 rounded-full bg-ok-fill" />
            Live on Whitechain {cfg?.chainId ?? 1874} · gasless USDT
          </motion.div>
          <motion.h1 {...rise(1)} className="display-xl mt-6 text-paper">
            Invoices that <em className="metal-text pr-1">prove</em> themselves.
          </motion.h1>
          <motion.p {...rise(2)} className="mt-6 max-w-xl text-[18px] leading-8 text-paper/65">
            Bill clients in USDT on Whitechain. They pay without gas. Your CA or bank checks every payment from a QR code, without asking you for screenshots.
          </motion.p>
          <motion.div {...rise(3)} className="mt-9 flex flex-wrap gap-3">
            <Link href="/create" className="inline-flex h-12 items-center gap-2 rounded-full bg-paper px-6 text-[15px] font-medium text-ink transition-colors hover:bg-white">
              Create an invoice <ArrowRight className="size-4" />
            </Link>
            {askId ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^\d+$/.test(id)) window.location.href = `/verify/${id}`;
                }}
              >
                <input
                  autoFocus
                  inputMode="numeric"
                  placeholder="Invoice #"
                  value={id}
                  onChange={(e) => setId(e.target.value.replace(/\D/g, ""))}
                  aria-label="Invoice number"
                  className="num h-12 w-36 rounded-full border border-white/20 bg-white/[0.04] px-5 text-paper outline-none placeholder:text-paper/40 focus:border-paper/70"
                />
                <button type="submit" className="h-12 rounded-full border border-white/20 px-6 text-[15px] text-paper hover:bg-white/[0.06]">
                  Verify
                </button>
              </form>
            ) : (
              <button onClick={() => setAskId(true)} className="h-12 rounded-full border border-white/20 px-6 text-[15px] text-paper hover:bg-white/[0.06]">
                Verify an invoice
              </button>
            )}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, ease: ease.out }}
          className="relative mx-auto aspect-square w-full max-w-[560px] md:-mr-8"
        >
          <MetalCoin />
        </motion.div>
      </div>

      <div className="mx-auto max-w-[1120px] px-4 pb-14 md:-mt-16 md:px-6">
        <motion.div {...rise(4)} className="grid grid-cols-2 divide-white/10 rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-md md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-white/10 md:[&>*]:border-b-0">
          <Stat label="Invoices recorded" value={stats ? stats.invoices : null} />
          <Stat label="Settled onchain" value={stats ? toNumber(stats.settled) : null} decimals={2} unit="USDT" />
          <Stat label="Paid without gas" value={stats ? stats.gasless : null} />
          <Stat label="Receipts minted" value={stats ? stats.receipts : null} />
        </motion.div>
      </div>
    </section>
  );
}
