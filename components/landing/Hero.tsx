"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useHisaab } from "@/lib/hisaab";
import { useProfile } from "@/lib/profile";
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
      const [list, paid] = await Promise.all([cfg.hisaab.many(ids), cfg.hisaab.payments()]);
      if (!live) return;
      setStats({
        invoices: Number(next - 1n),
        settled: list.reduce((s, i) => s + i.paid - i.refunded, 0n),
        receipts: list.filter((i) => i.status === "Paid").length,
        gasless: paid.filter((p) => p.gasless).length,
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
    <div className="bg-paper/80 px-5 py-5 md:px-7">
      <div className="label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        {value === null ? <span className="skeleton h-8 w-20" /> : <NumberTicker value={value} decimalPlaces={decimals} className="text-[26px] md:text-[30px]" />}
        {unit && value !== null && <span className="text-sm text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}

export function Hero() {
  const router = useRouter();
  const { cfg } = useHisaab();
  const { loggedIn } = useProfile();
  const stats = useRegistryStats();
  const [id, setId] = useState("");
  const rise = (i: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: dur.long, delay: 0.1 + i * 0.1, ease: ease.out },
  });

  return (
    <section className="grid-bg relative isolate overflow-hidden border-b border-rule">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="hero-glow absolute top-[-25%] right-[-8%] h-[85%] w-[60%] rounded-full bg-[radial-gradient(closest-side,rgb(245_182_42/0.16),transparent)] blur-2xl" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-paper" />
      </div>

      <div className="mx-auto grid max-w-[1200px] items-center gap-6 px-4 pt-14 md:min-h-[calc(100dvh-64px)] md:grid-cols-[1.1fr_1fr] md:px-6 md:pt-4">
        <div className="relative z-10">
          <motion.div {...rise(0)} className="inline-flex items-center gap-2 border border-rule-strong bg-paper-2/70 px-3 py-1.5 text-[12px] tracking-[0.12em] text-ink-2 uppercase">
            <span className="size-1.5 bg-ok-fill" />
            Live on Whitechain {cfg?.chainId ?? 1874} · gasless USDT
          </motion.div>
          <motion.h1 {...rise(1)} className="display-xl mt-6">
            Invoices that <em>prove</em> themselves.
          </motion.h1>
          <motion.p {...rise(2)} className="mt-6 max-w-xl text-[17px] leading-8 text-ink-2">
            Bill clients in USDT on Whitechain. They pay without gas. Companies vouch for their people on ENS, and any CA or bank checks a payment from a QR code.
          </motion.p>
          <motion.div {...rise(3)} className="mt-9 flex flex-wrap gap-3">
            <Link href={loggedIn ? "/dashboard" : "/login"} className="flex h-12 items-center gap-2 bg-accent px-6 text-[15px] font-semibold text-accent-ink hover:bg-accent-2">
              {loggedIn ? "Open dashboard" : "Log in or sign up"} <ArrowRight className="size-4" />
            </Link>
            <form
              className="flex"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(/^\d+$/.test(id) ? `/verify/${id}` : "/verify");
              }}
            >
              <input
                inputMode="numeric"
                placeholder="Invoice #"
                value={id}
                onChange={(e) => setId(e.target.value.replace(/\D/g, ""))}
                aria-label="Invoice number to verify"
                className="num h-12 w-32 border border-r-0 border-rule-strong bg-paper-2/70 px-4 outline-none placeholder:text-ink-3 focus:border-accent"
              />
              <button type="submit" className="flex h-12 items-center gap-2 border border-rule-strong px-5 text-[15px] hover:border-accent hover:text-accent">
                <ShieldCheck className="size-4" /> Verify
              </button>
            </form>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease: ease.out }} className="relative mx-auto aspect-square w-full max-w-[540px]">
          <MetalCoin />
        </motion.div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 pb-14 md:-mt-10 md:px-6">
        <motion.div {...rise(4)} className="grid grid-cols-2 gap-px border border-rule bg-rule backdrop-blur-md md:grid-cols-4">
          <Stat label="Invoices recorded" value={stats ? stats.invoices : null} />
          <Stat label="Settled onchain" value={stats ? toNumber(stats.settled) : null} decimals={2} unit="USDT" />
          <Stat label="Paid without gas" value={stats ? stats.gasless : null} />
          <Stat label="Receipts minted" value={stats ? stats.receipts : null} />
        </motion.div>
      </div>
    </section>
  );
}
