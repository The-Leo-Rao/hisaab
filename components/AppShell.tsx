"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode } from "react";
import { motion } from "motion/react";
import { Building2, ChevronDown, FilePlus2, Fingerprint, LayoutDashboard, LogOut, Network, ReceiptText, ShieldCheck, Wallet } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { DropdownMenu } from "radix-ui";
import { useDisconnect } from "wagmi";
import { useHisaab } from "@/lib/hisaab";
import { useProfile } from "@/lib/profile";
import { dur, ease } from "@/lib/motion";
import { middle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Brand } from "@/components/Brand";

const CORPORATE = [
  ["/dashboard", "Dashboard", LayoutDashboard],
  ["/subregistries", "Subregistries", Network],
  ["/payables", "Payroll", Wallet],
  ["/verify", "Verify invoice", ShieldCheck],
  ["/identity", "ENS records", Fingerprint],
] as const;

const FREELANCER = [
  ["/dashboard", "Dashboard", LayoutDashboard],
  ["/create", "New invoice", FilePlus2],
  ["/invoices", "My invoices", ReceiptText],
  ["/verify", "Verify invoice", ShieldCheck],
  ["/identity", "ENS records", Fingerprint],
] as const;

const PUBLIC = ["/", "/login"];

export function IdentitySwitch() {
  const { cfg, choice, choose, identity, me } = useHisaab();
  if (!cfg) return <span className="skeleton h-10 w-40" />;
  if (!cfg.local) return <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex h-10 items-center gap-2 rounded-sm border border-rule-strong bg-paper-2 px-3 text-left hover:border-ink-3">
          <span className="grid leading-tight">
            <span className="text-sm font-medium">{identity ? identity.label : "Browser wallet"}</span>
            <span className="num text-[11px] text-ink-3">{identity?.ens ?? middle(me)}</span>
          </span>
          <ChevronDown className="size-4 text-ink-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-64 rounded-sm border border-rule-strong bg-paper-2 p-1 shadow-[var(--shadow-sheet)]">
            <DropdownMenu.Label className="label px-3 pt-2 pb-1">Demo identities · local fork</DropdownMenu.Label>
            {cfg.identities.map((i) => (
              <DropdownMenu.Item
                key={i.key}
                onSelect={() => choose(i.key)}
                className={cn("flex cursor-pointer flex-col rounded-sm px-3 py-2 outline-none data-[highlighted]:bg-white/5", choice === i.key && "bg-white/5")}
              >
                <span className="text-sm font-medium">
                  {i.label} <span className="font-normal text-ink-3">· {i.persona}</span>
                </span>
                <span className="num text-xs text-ink-3">{i.ens ?? middle(i.address)}</span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            <DropdownMenu.Item onSelect={() => choose("wallet")} className="cursor-pointer rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-white/5">
              Use a browser wallet
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {choice === "wallet" && <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />}
    </div>
  );
}

function NetworkChip() {
  const { cfg } = useHisaab();
  return (
    <span className="num rounded-sm border border-rule-strong px-1.5 py-0.5 text-[10px] tracking-[0.1em] whitespace-nowrap text-ink-3">
      WHITECHAIN · {cfg?.chainId ?? 1874}
      {cfg?.local ? " · FORK" : ""}
    </span>
  );
}

function TopBar() {
  const { loggedIn } = useProfile();
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-3">
          <Brand className="text-[24px]" />
          <span className="hidden sm:inline">
            <NetworkChip />
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-2">
          <Link href="/verify" className={cn("hidden h-10 items-center px-3 text-sm text-ink-2 hover:text-ink sm:flex", path.startsWith("/verify") && "text-ink")}>
            Verify invoice
          </Link>
          {path.startsWith("/pay") ? (
            <IdentitySwitch />
          ) : (
            <Link href={loggedIn ? "/dashboard" : "/login"} className="flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-2">
              {loggedIn ? "Open dashboard" : "Log in"}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const { profile, signOut, me } = useProfile();
  const { cfg } = useHisaab();
  const { disconnect } = useDisconnect();
  const nav = profile?.role === "corporate" ? CORPORATE : FREELANCER;

  function logout() {
    signOut();
    if (!cfg?.local) disconnect();
    router.push("/login");
  }

  return (
    <aside className="border-rule bg-[#090a0d] md:sticky md:top-0 md:flex md:h-dvh md:w-[260px] md:shrink-0 md:flex-col md:border-r">
      <div className="flex h-16 items-center justify-between gap-3 border-b border-rule px-5">
        <Link href="/dashboard">
          <Brand className="text-[24px]" />
        </Link>
        <NetworkChip />
      </div>
      <div className="hidden border-b border-rule px-5 py-4 md:block">
        <div className="flex items-center gap-2">
          {profile?.role === "corporate" ? <Building2 className="size-4 text-accent" /> : <ReceiptText className="size-4 text-accent" />}
          <span className="label text-accent">{profile?.role === "corporate" ? "Corporation" : "Freelancer"}</span>
        </div>
        <div className="mt-2 truncate font-medium">{profile?.name || "—"}</div>
        <div className="num truncate text-[12px] text-ink-3">{profile?.ens || middle(me)}</div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] md:flex-col md:py-4">
        {nav.map(([href, label, Icon]) => {
          const active = path === href || (href !== "/dashboard" && path.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex shrink-0 items-center gap-3 rounded-sm px-3 py-2.5 text-[14px] text-ink-2 hover:bg-white/[0.04] hover:text-ink",
                active && "bg-white/[0.06] text-ink",
              )}
            >
              {active && <span className="absolute inset-y-1 left-0 hidden w-[2px] bg-accent md:block" />}
              <Icon className={cn("size-4", active ? "text-accent" : "text-ink-3")} strokeWidth={1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden gap-3 border-t border-rule p-4 md:grid">
        <IdentitySwitch />
        <button onClick={logout} className="flex items-center gap-2 text-sm text-ink-3 hover:text-ink">
          <LogOut className="size-4" /> Log out
        </button>
      </div>
    </aside>
  );
}

function LoginGate() {
  const path = usePathname();
  return (
    <div className="mx-auto mt-24 grid max-w-md gap-4 border border-rule bg-card p-8 text-center">
      <h1 className="title">Log in to continue</h1>
      <p className="text-ink-2">Connect your wallet and choose corporation or freelancer to open this page.</p>
      <Link href={`/login?next=${encodeURIComponent(path)}`} className="mx-auto flex h-11 items-center bg-accent px-6 font-semibold text-accent-ink hover:bg-accent-2">
        Log in
      </Link>
    </div>
  );
}

const OPEN_WITHOUT_LOGIN = (p: string) => p.startsWith("/pay") || p.startsWith("/verify");

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { error } = useHisaab();
  const { loggedIn, ready } = useProfile();
  const banner = error && (
    <div className="border-b border-bad/40 bg-bad-fill/10 px-4 py-3 text-center text-sm text-bad" role="alert">
      {error}
    </div>
  );

  if (!ready && !PUBLIC.includes(path) && !OPEN_WITHOUT_LOGIN(path)) return <div className="min-h-dvh" />;

  if (PUBLIC.includes(path) || !loggedIn) {
    const bare = PUBLIC.includes(path);
    const gated = !bare && !OPEN_WITHOUT_LOGIN(path);
    return (
      <>
        <TopBar />
        {banner}
        <motion.main
          key={path}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: dur.short, ease: ease.out }}
          className={bare ? "w-full" : "mx-auto w-full max-w-[1200px] px-4 pt-8 pb-24 md:px-6 md:pt-12"}
        >
          {gated ? ready && <LoginGate /> : children}
        </motion.main>
      </>
    );
  }

  return (
    <div className="md:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        {banner}
        <motion.main
          key={path}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: dur.short, ease: ease.out }}
          className="mx-auto w-full max-w-[1120px] px-4 pt-8 pb-24 md:px-10 md:pt-10"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}

export function PageTitle({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
      <div className="min-w-0">
        <h1 className="display">{title}</h1>
        {sub && <p className="mt-2 max-w-2xl text-ink-2">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
