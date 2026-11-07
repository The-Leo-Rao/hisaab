"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { DropdownMenu } from "radix-ui";
import { useHisaab } from "@/lib/hisaab";
import { dur, ease, isDemo } from "@/lib/motion";
import { middle } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  ["/create", "Create"],
  ["/invoices", "Invoices"],
  ["/payables", "Payables"],
  ["/verify", "Verify"],
  ["/identity", "Identity"],
] as const;

function IdentitySwitch({ dark }: { dark: boolean }) {
  const { cfg, choice, choose, identity, me } = useHisaab();
  if (!cfg) return <span className="skeleton h-9 w-40" />;
  if (!cfg.local) return <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />;
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className={cn(
            "flex h-10 items-center gap-2 rounded-sm border px-3 text-left",
            dark ? "border-white/15 bg-white/[0.04] text-paper hover:bg-white/[0.08]" : "border-rule-strong bg-card hover:bg-paper-2",
          )}
        >
          <span className="grid leading-tight">
            <span className="text-sm font-medium">{identity ? identity.label : "Browser wallet"}</span>
            <span className={cn("num text-[11px]", dark ? "text-paper/55" : "text-ink-3")}>{identity?.ens ?? middle(me)}</span>
          </span>
          <ChevronDown className="size-4 text-ink-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-64 rounded-md border border-rule bg-card p-1 shadow-[var(--shadow-sheet)]">
            <DropdownMenu.Label className="label px-3 pt-2 pb-1">Demo identities · local fork</DropdownMenu.Label>
            {cfg.identities.map((i) => (
              <DropdownMenu.Item
                key={i.key}
                onSelect={() => choose(i.key)}
                className={cn("flex cursor-pointer flex-col rounded-sm px-3 py-2 outline-none data-[highlighted]:bg-paper-2", choice === i.key && "bg-paper-2")}
              >
                <span className="text-sm font-medium">
                  {i.label} <span className="font-normal text-ink-3">· {i.persona}</span>
                </span>
                <span className="num text-xs text-ink-3">{i.ens ?? middle(i.address)}</span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            <DropdownMenu.Item onSelect={() => choose("wallet")} className="cursor-pointer rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-paper-2">
              Use a browser wallet
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {choice === "wallet" && <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { cfg, error } = useHisaab();
  const dark = path === "/";
  useEffect(() => {
    if (isDemo()) document.body.classList.remove("grain");
  }, []);
  return (
    <>
      <header className={cn("sticky top-0 z-40 border-b backdrop-blur-[2px]", dark ? "border-white/10 bg-[#060a12]/85 text-paper" : "border-rule bg-paper/95")}>
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-4 px-4 md:px-6">
          <Link href="/" className="flex items-baseline gap-3">
            <span className="font-display text-[26px] leading-none">Hisaab</span>
            <span className={cn("num hidden rounded-sm border px-1.5 py-0.5 text-[10px] tracking-[0.08em] sm:inline", dark ? "border-white/15 text-paper/55" : "border-rule text-ink-3")}>
              WHITECHAIN · {cfg?.chainId ?? 1874}
              {cfg?.local ? " · FORK" : ""}
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "rounded-sm px-3 py-2 text-[15px]",
                  dark ? "text-paper/65 hover:text-paper" : "text-ink-2 hover:text-ink",
                  path.startsWith(href) && "text-ink underline decoration-ink decoration-2 underline-offset-[10px]",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <IdentitySwitch dark={dark} />
          </div>
        </div>
        <nav className={cn("flex gap-1 overflow-x-auto border-t px-2 [scrollbar-width:none] md:hidden", dark ? "border-white/10" : "border-rule")}>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={cn("shrink-0 px-3 py-2.5 text-sm", dark ? "text-paper/65" : "text-ink-2", path.startsWith(href) && "font-medium text-ink")}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {error && (
        <div className="border-b border-bad/40 bg-bad-fill/10 px-4 py-3 text-center text-[15px] text-bad" role="alert">
          {error}
        </div>
      )}
      <motion.main
        key={path}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: dur.short, ease: ease.out }}
        className={dark ? "w-full" : "mx-auto w-full max-w-[1120px] px-4 pt-8 pb-24 md:px-6 md:pt-12"}
      >
        {children}
      </motion.main>
    </>
  );
}

export function PageTitle({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display">{title}</h1>
        {sub && <p className="mt-2 text-ink-2">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
