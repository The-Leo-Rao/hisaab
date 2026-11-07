"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { useSwitchChain, useWalletClient } from "wagmi";
import { explainError } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import type { UnsignedTx } from "@/lib/api";
import { sepolia } from "@/lib/wagmi";
import { middle, same } from "@/lib/format";
import type { Step } from "@/components/TxProgress";

export function useEnsSender() {
  const { cfg } = useHisaab();
  const { data: wallet } = useWalletClient({ chainId: sepolia.id });
  const { switchChainAsync } = useSwitchChain();
  return async (tx: UnsignedTx): Promise<Hex> => {
    if (!cfg) throw new Error("Not connected.");
    const c = cfg.sepoliaClient;
    if (cfg.local) {
      await c.request({ method: "anvil_impersonateAccount" as never, params: [tx.from] as never });
      try {
        const hash = (await c.request({ method: "eth_sendTransaction" as never, params: [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value }] as never })) as Hex;
        const r = await c.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("The ENS transaction reverted.");
        return hash;
      } finally {
        await c.request({ method: "anvil_stopImpersonatingAccount" as never, params: [tx.from] as never }).catch(() => {});
      }
    }
    if (!wallet) {
      await switchChainAsync({ chainId: sepolia.id });
      throw new Error("Switched your wallet to Sepolia. Press the button again.");
    }
    if (!same(wallet.account.address, tx.from)) throw new Error(`Connect ${middle(tx.from)} on Sepolia; it controls this name.`);
    const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value || "0"), account: wallet.account, chain: sepolia });
    const r = await c.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("The ENS transaction reverted.");
    return hash;
  };
}

export type TxStep = { label: string; txs: () => Promise<UnsignedTx[]> };

export function useTxRunner() {
  const send = useEnsSender();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSteps(list: TxStep[], after?: () => void) {
    setBusy(true);
    setError(null);
    const s: Step[] = list.map((x) => ({ label: x.label, state: "todo" }));
    setSteps([...s]);
    for (const [i, x] of list.entries()) {
      s[i] = { ...s[i], state: "active" };
      setSteps([...s]);
      try {
        let last: Hex | undefined;
        for (const tx of await x.txs()) last = await send(tx);
        s[i] = { ...s[i], state: "done", hash: last };
        setSteps([...s]);
      } catch (e) {
        s[i] = { ...s[i], state: "error" };
        setSteps([...s]);
        setError(explainError(e));
        setBusy(false);
        return false;
      }
    }
    setBusy(false);
    after?.();
    return true;
  }

  async function run(build: () => Promise<{ label: string; tx: UnsignedTx }[]>, after?: () => void) {
    let list: { label: string; tx: UnsignedTx }[];
    try {
      list = await build();
    } catch (e) {
      setSteps(null);
      setError(explainError(e));
      return false;
    }
    return runSteps(list.map((x) => ({ label: x.label, txs: async () => [x.tx] })), after);
  }

  return { run, runSteps, steps, error, busy, fail: setError, reset: () => (setSteps(null), setError(null)) };
}
