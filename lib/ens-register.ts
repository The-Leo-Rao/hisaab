"use client";

import { encodeFunctionData, maxUint256, parseAbi, type Address, type PublicClient } from "viem";
import { ensRegister, type UnsignedTx } from "@/lib/api";
import type { TxStep } from "@/lib/ens-tx";

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const YEAR = String(365 * 86_400);

export const isTopLevel = (name: string) => /^[a-z0-9-]{3,}\.eth$/.test(name);

const tx = (from: Address, to: Address, data: `0x${string}`, action: string): UnsignedTx => ({ action, name: "", from, to, data, value: "0x0", chainId: 11155111 });

const pending = (name: string) => `hisaab:ens-commit:${name}`;

export function registrationSteps(client: PublicClient, name: string, owner: Address, total: bigint, token: Address): TxStep[] {
  const body = { name, owner, from: owner, duration: YEAR };
  let registrar: Address;
  return [
    {
      label: "Get the registration fee (test MockUSDC)",
      txs: async () => {
        registrar = (await ensRegister.status()).registrar as Address;
        const bal = await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [owner] });
        return bal >= total ? [] : [tx(owner, token, encodeFunctionData({ abi: erc20, functionName: "mint", args: [owner, total - bal] }), "mint-fee")];
      },
    },
    {
      label: "Approve the fee",
      txs: async () => {
        const allowed = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [owner, registrar] });
        return allowed >= total ? [] : [tx(owner, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [registrar, maxUint256] }), "approve-fee")];
      },
    },
    {
      label: `Commit to ${name}`,
      txs: async () => {
        const c = await ensRegister.commit(body);
        try {
          localStorage.setItem(pending(name), JSON.stringify({ secret: c.secret, commitment: c.commitment }));
        } catch {}
        return [c];
      },
    },
    {
      label: "Wait for the registrar (about a minute)",
      txs: async () => {
        const { commitment } = JSON.parse(localStorage.getItem(pending(name)) ?? "{}");
        for (;;) {
          const s = await ensRegister.commitmentStatus(commitment);
          if (s.canReveal) break;
          await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(s.remainingSeconds) * 1000, 3000), 15000)));
        }
        await new Promise((r) => setTimeout(r, 8000));
        return [];
      },
    },
    {
      label: `Register ${name}`,
      txs: async () => {
        const { secret } = JSON.parse(localStorage.getItem(pending(name)) ?? "{}");
        const r = await ensRegister.reveal({ ...body, secret });
        try {
          localStorage.removeItem(pending(name));
        } catch {}
        return [r];
      },
    },
  ];
}
