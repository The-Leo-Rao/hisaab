import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Address, Hex } from "viem";

export type Network = {
  chainId: number;
  rpcUrl: string;
  registry: Address;
  receipt: Address;
  usdt: Address;
  deployBlock: string;
  verifyBase: string;
  local: boolean;
  relayerKey?: Hex;
};

export type DemoNames = {
  names: Record<string, string>;
  wallets: Record<string, Address>;
  controllers: Record<string, Address>;
};

const OFFICIAL_USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";

function readJson<T>(file: string | undefined): T | null {
  if (!file) return null;
  const full = path.resolve(/*turbopackIgnore: true*/ process.cwd(), file);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as T;
  } catch {
    return null;
  }
}

export function network(): Network | null {
  const env = process.env;
  if (env.HISAAB_NETWORK === "whitechain") {
    if (!env.HISAAB_REGISTRY || !env.HISAAB_RECEIPT) return null;
    return {
      chainId: 1874,
      rpcUrl: env.WC_RPC || "https://rpc.testnet.whitechain.io",
      registry: env.HISAAB_REGISTRY as Address,
      receipt: env.HISAAB_RECEIPT as Address,
      usdt: (env.HISAAB_USDT || OFFICIAL_USDT) as Address,
      deployBlock: env.HISAAB_DEPLOY_BLOCK || "0",
      verifyBase: env.VERIFY_BASE || "https://hisaab.vercel.app/verify/",
      local: false,
      relayerKey: env.RELAYER_PK as Hex | undefined,
    };
  }
  const file = readJson<Omit<Network, "local">>(env.HISAAB_DEPLOY_FILE || "./HSB_Contract/.deploy.local.json");
  if (!file) return null;
  return { ...file, relayerKey: (env.RELAYER_PK as Hex | undefined) ?? file.relayerKey, local: true };
}

export function sepoliaRpc(): string {
  return process.env.SEPOLIA_RPC || (network()?.local ? "http://127.0.0.1:8546" : "https://ethereum-sepolia-rpc.publicnode.com");
}

export function demoNames(): DemoNames | null {
  const demo = readJson<{
    names: { company: string; freelancer: string; engagement: string; contractors: string[] };
    whitechainWallets: Record<string, Address>;
    ensControllers: Record<string, Address>;
  }>(process.env.HISAAB_ENS_DEMO_FILE || "../HSB_ENSv2/.ens-demo.json");
  if (!demo) return null;
  const names: Record<string, string> = {
    acme: demo.names.company,
    ravi: demo.names.engagement,
  };
  for (const c of demo.names.contractors) {
    const who = c.split(".")[0];
    if (who !== "ravi") names[who] = c;
  }
  return { names, wallets: demo.whitechainWallets, controllers: demo.ensControllers ?? {} };
}
