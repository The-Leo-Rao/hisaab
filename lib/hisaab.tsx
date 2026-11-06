"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, createWalletClient, http, type Address, type Chain, type PublicClient } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { createHisaab, explorerTx, type Hisaab, type Signer } from "@hisaab/core";
import { sepolia, SEPOLIA_RPC, WC_RPC, whitechain } from "@/lib/wagmi";
import { same } from "@/lib/format";

export type Persona = "freelancer" | "company" | "contractor" | "other";
export type Identity = { key: string; label: string; persona: Persona; legalName: string; ens?: string; address: Address };

export type Config = {
  chainId: number;
  registry: Address;
  receipt: Address;
  usdt: Address;
  deployBlock: bigint;
  verifyBase: string;
  local: boolean;
  relayer: Address | null;
  identities: Identity[];
  chain: Chain;
  client: PublicClient;
  sepoliaClient: PublicClient;
  hisaab: Hisaab;
};

const STRANGER = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" as Address;

const PEOPLE: Record<string, { label: string; persona: Persona; legalName: string }> = {
  ravi: { label: "Ravi", persona: "freelancer", legalName: "Ravi Desai" },
  acme: { label: "Acme Labs", persona: "company", legalName: "Acme Labs Inc." },
  priya: { label: "Priya", persona: "contractor", legalName: "Priya Nair" },
  arjun: { label: "Arjun", persona: "contractor", legalName: "Arjun Mehta" },
};

type RawConfig = {
  chainId: number;
  registry: Address;
  receipt: Address;
  usdt: Address;
  deployBlock: string;
  verifyBase: string;
  local: boolean;
  relayer: Address | null;
  demo: { names: Record<string, string>; wallets: Record<string, Address> } | null;
};

function build(raw: RawConfig): Config {
  const client = createPublicClient({ chain: whitechain, transport: http(WC_RPC), pollingInterval: raw.local ? 1000 : 4000 }) as PublicClient;
  const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) }) as PublicClient;
  const deployBlock = BigInt(raw.deployBlock);
  const identities: Identity[] = [];
  if (raw.local && raw.demo) {
    for (const [key, address] of Object.entries(raw.demo.wallets)) {
      const p = PEOPLE[key];
      if (p) identities.push({ key, address, ens: raw.demo.names[key], ...p });
    }
    identities.push({ key: "stranger", address: STRANGER, label: "Stranger", persona: "other", legalName: "Unknown" });
  }
  return {
    ...raw,
    deployBlock,
    identities,
    chain: whitechain,
    client,
    sepoliaClient,
    hisaab: createHisaab(client, { registry: raw.registry, receipt: raw.receipt, usdt: raw.usdt, deployBlock }),
  };
}

type Ctx = {
  cfg: Config | null;
  error: string | null;
  choice: string;
  choose: (key: string) => void;
  signer: Signer | null;
  me: Address | null;
  identity: Identity | null;
  tick: number;
  refresh: () => void;
  nameOf: (addr?: string | null) => string | undefined;
  txUrl: (hash: string) => string | undefined;
};

const HisaabCtx = createContext<Ctx | null>(null);

export function HisaabProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState("wallet");
  const [tick, setTick] = useState(0);
  const { data: walletClient } = useWalletClient({ chainId: whitechain.id });
  const { address: walletAddress } = useAccount();

  useEffect(() => {
    let live = true;
    fetch("/api/config", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Configuration unavailable.");
        return build(j as RawConfig);
      })
      .then((c) => {
        if (!live) return;
        setCfg(c);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem("hisaab:acct");
        } catch {}
        if (c.local) setChoice(saved && (saved === "wallet" || c.identities.some((i) => i.key === saved)) ? saved : c.identities[0]?.key ?? "wallet");
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  const choose = useCallback((key: string) => {
    setChoice(key);
    try {
      localStorage.setItem("hisaab:acct", key);
    } catch {}
  }, []);

  const identity = cfg?.identities.find((i) => i.key === choice) ?? null;

  const signer = useMemo<Signer | null>(() => {
    if (!cfg) return null;
    if (identity) return createWalletClient({ chain: whitechain, transport: http(WC_RPC), account: identity.address }) as unknown as Signer;
    if (walletClient && choice === "wallet") return walletClient as unknown as Signer;
    return null;
  }, [cfg, identity, walletClient, choice]);

  const me = (identity?.address ?? (choice === "wallet" ? walletAddress : undefined) ?? null) as Address | null;

  const nameOf = useCallback(
    (addr?: string | null) => cfg?.identities.find((i) => same(i.address, addr))?.ens,
    [cfg],
  );
  const txUrl = useCallback((hash: string) => (cfg && !cfg.local ? explorerTx(cfg.chain, hash) : undefined), [cfg]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const value = useMemo(
    () => ({ cfg, error, choice, choose, signer, me, identity, tick, refresh, nameOf, txUrl }),
    [cfg, error, choice, choose, signer, me, identity, tick, refresh, nameOf, txUrl],
  );
  return <HisaabCtx.Provider value={value}>{children}</HisaabCtx.Provider>;
}

export function useHisaab() {
  const c = useContext(HisaabCtx);
  if (!c) throw new Error("useHisaab outside HisaabProvider");
  return c;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, deps);
  return { data, error, loading, setData };
}
