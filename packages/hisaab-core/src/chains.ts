import { defineChain, type Chain } from "viem";
import { foundry } from "viem/chains";

export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" } },
  testnet: true,
});

export const localAnvil = foundry;

export const WHITECHAIN_USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" as const;

export function chainFor(id: number, rpcUrl?: string): Chain {
  const base = id === whitechainSepolia.id ? whitechainSepolia : id === localAnvil.id ? localAnvil : undefined;
  if (!base) throw new Error(`unsupported chain ${id}`);
  if (!rpcUrl) return base;
  return { ...base, rpcUrls: { default: { http: [rpcUrl] } } };
}

export function explorerTx(chain: Chain, hash: string): string | undefined {
  const url = chain.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : undefined;
}
