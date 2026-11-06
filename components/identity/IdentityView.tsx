"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { isAddress, type Hex } from "viem";
import { useSwitchChain, useWalletClient } from "wagmi";
import { approvalCommitment, decodeFragment, explainError, parseLink, walletCommitment } from "@hisaab/core";
import { useHisaab } from "@/lib/hisaab";
import { nameSaltFor } from "@/lib/sealed";
import { loadDoc } from "@/lib/store";
import { api, type EnsName, type UnsignedTx } from "@/lib/api";
import { sepolia } from "@/lib/wagmi";
import { longDate, middle, same } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Hash } from "@/components/Hash";
import { ensState } from "@/components/IdentityChip";
import { TxProgress, type Step } from "@/components/TxProgress";
import { toneFill, toneText } from "@/components/tone";

const KEYS = ["hisaab.registry", "hisaab.wallet", "hisaab.employer", "hisaab.role", "hisaab.client", "hisaab.approved"];
const SUGGEST = ["acme-labs.eth", "priya.dev.acme-labs.eth", "arjun.dev.acme-labs.eth", "ravi-dev.eth", "acme-q4.ravi-dev.eth"];

function useSender() {
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
    if (!same(wallet.account.address, tx.from)) throw new Error(`Connect ${middle(tx.from)}; it controls this name.`);
    const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value || "0"), account: wallet.account, chain: sepolia });
    const r = await c.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("The ENS transaction reverted.");
    return hash;
  };
}

function useRunner() {
  const send = useSender();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(build: () => Promise<{ label: string; tx: UnsignedTx }[]>, after?: () => void) {
    setBusy(true);
    setError(null);
    let list: { label: string; tx: UnsignedTx }[] = [];
    try {
      list = await build();
    } catch (e) {
      setSteps(null);
      setError(explainError(e));
      setBusy(false);
      return;
    }
    const s: Step[] = list.map((x) => ({ label: x.label, state: "todo" }));
    setSteps([...s]);
    for (const [i, x] of list.entries()) {
      s[i] = { ...s[i], state: "active" };
      setSteps([...s]);
      try {
        const hash = await send(x.tx);
        s[i] = { ...s[i], state: "done", hash };
        setSteps([...s]);
      } catch (e) {
        s[i] = { ...s[i], state: "error" };
        setSteps([...s]);
        setError(explainError(e));
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    after?.();
  }
  return { run, steps, error, busy, fail: setError };
}

export function IdentityView() {
  const { cfg, identity } = useHisaab();
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(params.get("name") ?? "");
  const [info, setInfo] = useState<EnsName | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);

  const name = params.get("name") ?? "";
  useEffect(() => {
    if (!name) return setInfo(null);
    let live = true;
    setLoading(true);
    api
      .ensName(name)
      .then((d) => live && (setInfo(d), setErr(null)))
      .catch((e) => live && setErr(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [name, n]);

  const root = name.split(".").slice(-2).join(".");
  const controllerKey = root === "acme-labs.eth" ? "acme" : root === "ravi-dev.eth" ? "ravi" : "";
  const defaultController = (cfg?.controllers[controllerKey] ?? "") as string;
  const state = ensState(info);

  return (
    <div className="mx-auto max-w-[720px]">
      <PageTitle title={<>Identity on <em>ENS</em></>} sub="Look up a name, read its Hisaab records, and set them. Records live on ENSv2, Ethereum Sepolia." />
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) router.push(`/identity?name=${encodeURIComponent(query.trim().toLowerCase())}`);
        }}
      >
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name.eth" className="num" aria-label="ENS name" />
        <Button type="submit">Look up</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGEST.map((s) => (
          <button key={s} onClick={() => (setQuery(s), router.push(`/identity?name=${s}`))} className="num rounded-sm border border-rule-strong px-2 py-1 text-[13px] text-ink-2 hover:bg-paper-2">
            {s}
          </button>
        ))}
      </div>

      {err && <p className="mt-6 text-bad">{err}</p>}
      {loading && !info && <div className="skeleton mt-8 h-48" />}

      {info && (
        <section className="mt-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn("size-2.5 rounded-full", toneFill[state])} />
            <h2 className="num text-[22px]">{info.name}</h2>
            <span className={cn("text-sm font-medium capitalize", toneText[state])}>{info.revoked ? "revoked" : info.status}</span>
          </div>
          <div className="mt-6 border-t border-rule-strong">
            {[
              ["Expiry", info.expiry ? longDate(info.expiry) : "—"],
              ["Owner (ENS)", info.owner ? <Hash key="o" value={info.owner} /> : "—"],
              ["Resolver", info.resolver ? <Hash key="r" value={info.resolver} /> : "—"],
              ...KEYS.map((k) => [k, info.records?.[k] ? <span key={k} className="num break-all">{info.records[k]}</span> : <span key={k} className="text-ink-3">not set</span>]),
            ].map(([k, v]) => (
              <div key={String(k)} className="grid grid-cols-[150px_1fr] gap-4 border-b border-rule py-2.5 text-[15px]">
                <span className={cn(String(k).startsWith("hisaab.") ? "num text-[13px] text-ink-2" : "label self-center")}>{k}</span>
                <span className="min-w-0">{v}</span>
              </div>
            ))}
          </div>
          {info.reason && <p className="mt-3 text-sm text-ink-3">{info.reason}</p>}

          {info.status !== "unregistered" && info.resolver && (
            <div className="mt-10 grid gap-10">
              <RecordsForm name={info.name} defaultController={defaultController} defaultIssuer={identity?.address ?? ""} onDone={() => setN((x) => x + 1)} />
              {!info.records?.["hisaab.employer"] && info.name.split(".").length >= 3 && (
                <AckForm name={info.name} controller={defaultController} client={(cfg?.controllers.acme ?? "") as string} onDone={() => setN((x) => x + 1)} />
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function RecordsForm({ name, defaultController, defaultIssuer, onDone }: { name: string; defaultController: string; defaultIssuer: string; onDone: () => void }) {
  const { cfg, signer } = useHisaab();
  const [from, setFrom] = useState(defaultController);
  const [sealedWallet, setSealedWallet] = useState("");
  const [sealing, setSealing] = useState(false);
  const issuerIsMe = !!signer && same(signer.account.address, defaultIssuer);
  const contractorish = useMemo(() => name.split(".").length >= 4, [name]);
  const [kind, setKind] = useState<"freelance" | "contractor">(contractorish ? "contractor" : "freelance");
  const [employer, setEmployer] = useState(name.split(".").slice(-2).join("."));
  const [role, setRole] = useState("");
  const [client, setClient] = useState("");
  const r = useRunner();

  useEffect(() => setFrom(defaultController), [defaultController]);
  useEffect(() => setKind(contractorish ? "contractor" : "freelance"), [contractorish]);

  return (
    <form
      className="grid gap-4 rounded-md border border-rule bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        r.run(async () => {
          if (!isAddress(from)) throw new Error("Enter the wallet that controls this name.");
          if (!/^0x[0-9a-fA-F]{64}$/.test(sealedWallet)) throw new Error("Paste the issuer's sealed wallet value, or make yours with “Seal my wallet”.");
          const res = await api.ensRecords({ name, from, walletCommitment: sealedWallet, kind, employer: kind === "contractor" ? employer : undefined, role: role || undefined, client: client || undefined });
          return res.transactions.map((tx) => ({ label: `Set ${tx.key ?? "record"}`, tx }));
        }, onDone);
      }}
    >
      <div>
        <h3 className="title">Set Hisaab records</h3>
        <p className="mt-1 text-sm text-ink-2">Links this name to the wallet that issues invoices without publishing that wallet: ENS only stores a sealed value that a verifier can check once they hold an invoice and its key.</p>
      </div>
      <div className="flex gap-2">
        {(["freelance", "contractor"] as const).map((k) => (
          <button type="button" key={k} onClick={() => setKind(k)} className={cn("h-9 rounded-sm border px-3 text-sm capitalize", kind === k ? "border-ink bg-ink text-paper" : "border-rule-strong text-ink-2")}>
            {k}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Controller wallet (Sepolia)">
          <Input value={from} onChange={(e) => setFrom(e.target.value.trim())} className="num" />
        </Field>
        <Field label="Issuer's sealed wallet" hint={issuerIsMe ? "Signed by your Whitechain wallet. The signature stays in this browser." : "The issuer makes this on their own Identity page and sends it to you."}>
          <div className="flex gap-2">
            <Input value={sealedWallet} onChange={(e) => setSealedWallet(e.target.value.trim())} placeholder="0x…" className="num min-w-0 flex-1" />
            {issuerIsMe && (
              <Button
                type="button"
                variant="secondary"
                disabled={sealing}
                onClick={async () => {
                  if (!signer) return;
                  setSealing(true);
                  try {
                    setSealedWallet(walletCommitment(signer.account.address, await nameSaltFor(signer, name)));
                  } catch (e) {
                    r.fail(explainError(e));
                  } finally {
                    setSealing(false);
                  }
                }}
              >
                Seal my wallet
              </Button>
            )}
          </div>
        </Field>
        {kind === "contractor" ? (
          <>
            <Field label="Employer">
              <Input value={employer} onChange={(e) => setEmployer(e.target.value.trim())} className="num" />
            </Field>
            <Field label="Role">
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Product Designer, contract" />
            </Field>
          </>
        ) : (
          <Field label="Client (ENS)">
            <Input value={client} onChange={(e) => setClient(e.target.value.trim())} className="num" placeholder="acme-labs.eth" />
          </Field>
        )}
      </div>
      <Button type="submit" disabled={r.busy} className="justify-self-start">
        Prepare and send
      </Button>
      {(r.steps || r.error) && <TxProgress steps={r.steps ?? []} error={r.error} urlFor={cfg?.local ? () => undefined : (h) => `https://sepolia.etherscan.io/tx/${h}`} />}
    </form>
  );
}

function AckForm({ name, controller, client, onDone }: { name: string; controller: string; client: string; onDone: () => void }) {
  const { cfg } = useHisaab();
  const [ref, setRef] = useState("");
  const [clientWallet, setClientWallet] = useState(client);
  const r = useRunner();
  useEffect(() => setClientWallet(client), [client]);
  return (
    <div className="grid gap-4 rounded-md border border-rule bg-card p-5">
      <div>
        <h3 className="title">Client acknowledgement</h3>
        <p className="mt-1 text-sm text-ink-2">
          Let the client&apos;s ENS wallet write one key, <span className="num">hisaab.approved</span>, on this engagement name. The client then acknowledges invoices; check C shows it.
        </p>
      </div>
      <Field label="Client controller wallet (Sepolia)">
        <Input value={clientWallet} onChange={(e) => setClientWallet(e.target.value.trim())} className="num" />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={r.busy}
          onClick={() => r.run(async () => [{ label: "Grant the client the hisaab.approved key", tx: await api.clientRole({ name, from: controller, client: clientWallet }) }], onDone)}
        >
          Grant client role
        </Button>
        <div className="flex gap-2">
          <Input value={ref} onChange={(e) => setRef(e.target.value.trim())} placeholder="Pay link or invoice #" className="num w-56" aria-label="Pay link or invoice number" />
          <Button
            disabled={r.busy || !ref}
            onClick={() =>
              r.run(async () => {
                let id: bigint;
                let doc = null;
                if (/^\d+$/.test(ref)) {
                  id = BigInt(ref);
                  const inv = await cfg?.hisaab.getInvoice(id);
                  doc = inv ? loadDoc(inv.docHash) : null;
                } else {
                  const p = parseLink(ref);
                  id = p.id;
                  doc = await decodeFragment(p.fragment);
                }
                if (!doc) throw new Error("This browser doesn't have that invoice. Paste its pay link instead.");
                return [{ label: `Acknowledge invoice #${id}`, tx: await api.approve({ name, from: clientWallet, approval: approvalCommitment(id, doc.salt) }) }];
              }, onDone)
            }
          >
            Acknowledge
          </Button>
        </div>
      </div>
      {(r.steps || r.error) && <TxProgress steps={r.steps ?? []} error={r.error} urlFor={cfg?.local ? () => undefined : (h) => `https://sepolia.etherscan.io/tx/${h}`} />}
    </div>
  );
}

