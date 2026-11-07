"use client";

import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { Pencil, Plus, RefreshCw, UserX } from "lucide-react";
import { useHisaab } from "@/lib/hisaab";
import { useProfile } from "@/lib/profile";
import { api, ensWrite, type EnsName } from "@/lib/api";
import { useTxRunner } from "@/lib/ens-tx";
import { trackName, useSubnames, type Member } from "@/lib/subnames";
import { longDate, middle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Cell, EmptyState, Ledger, LedgerHead, LedgerRowBody, LedgerTh } from "@/components/Ledger";
import { TxProgress } from "@/components/TxProgress";
import { useEnsName } from "@/components/IdentityChip";

const day = 86_400;
const toDate = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
const toUnix = (iso: string) => Math.floor(Date.parse(`${iso}T23:59:59Z`) / 1000);

type Standing = "active" | "expired" | "revoked" | "missing";

function standing(info: EnsName | null): Standing {
  if (!info || !info.valid || info.status === "unregistered") return "missing";
  if (info.revoked) return "revoked";
  if (info.status === "expired" || info.status === "available") return "expired";
  return "active";
}

const STANDING: Record<Standing, string> = {
  active: "border-ok/50 text-ok",
  expired: "border-warn/50 text-warn",
  revoked: "border-bad/50 text-bad",
  missing: "border-rule-strong text-ink-3",
};

export function SubregistriesView() {
  const { cfg } = useHisaab();
  const { profile } = useProfile();
  const { address } = useAccount();
  const company = profile?.ens ?? "";
  const [n, setN] = useState(0);
  const { teams, members, loading } = useSubnames(company, n);
  const root = useEnsName(company, n);
  const [controller, setController] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const r = useTxRunner();

  useEffect(() => {
    const local = cfg?.local ? cfg.controllers[company.split(".")[0].replace(/-labs$/, "")] ?? cfg.controllers.acme : undefined;
    setController(local ?? root?.owner ?? address ?? "");
  }, [cfg, company, root?.owner, address]);

  const counts = useMemo(() => {
    const c = { active: 0, expired: 0, revoked: 0, missing: 0 };
    for (const m of members) c[standing(m.info)]++;
    return c;
  }, [members]);

  if (profile?.role !== "corporate") {
    return <EmptyState text="Subregistries are for corporations. Log in as a corporation to issue names to your people." />;
  }

  const refresh = () => setN((x) => x + 1);
  const from = () => {
    if (!isAddress(controller)) throw new Error("Enter the Sepolia wallet that controls " + company + ".");
    return controller;
  };

  function revoke(m: Member) {
    setConfirm(null);
    r.runSteps([{ label: `Revoke ${m.name}`, txs: async () => [await ensWrite.revoke({ name: m.name, from: from() })] }], refresh);
  }

  return (
    <div>
      <PageTitle
        title={<>Sub<em>registries</em></>}
        sub={`Names you issue under ${company}. Each person invoices under their name; revoke it and their invoices stop verifying.`}
        right={
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-px border border-rule bg-rule md:grid-cols-4">
        {[
          ["Company", root ? (root.valid ? root.status : "not found") : "…", company],
          ["Active", String(counts.active), "names issued"],
          ["Expired", String(counts.expired), "contract ended"],
          ["Revoked", String(counts.revoked), "offboarded"],
        ].map(([k, v, s]) => (
          <div key={k} className="bg-paper p-5">
            <div className="label">{k}</div>
            <div className="mt-1 text-[24px] font-semibold capitalize">{v}</div>
            <div className="num truncate text-[12px] text-ink-3">{s}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-2 border border-rule bg-card p-4 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Controller wallet on Sepolia" hint={`The wallet that owns ${company} on ENS signs every change here.${cfg?.local ? " On the local fork it is impersonated." : ""}`}>
          <Input value={controller} onChange={(e) => setController(e.target.value.trim())} className="num" placeholder="0x…" />
        </Field>
        {root?.owner && <span className="num pb-7 text-sm text-ink-3">ENS owner {middle(root.owner)}</span>}
      </div>

      <Ledger cols="minmax(0,1.6fr) minmax(0,1.2fr) 130px 110px 150px">
        <LedgerHead>
          <LedgerTh>Name</LedgerTh>
          <LedgerTh>Role</LedgerTh>
          <LedgerTh>Expiry</LedgerTh>
          <LedgerTh>Status</LedgerTh>
          <LedgerTh right>Actions</LedgerTh>
        </LedgerHead>
        {loading && members.length === 0 && [0, 1, 2].map((i) => <div key={i} className="skeleton my-2 h-12" />)}
        {!loading && members.length === 0 && <EmptyState text="No names issued yet. Add your first person below." />}
        {members.map((m) => {
          const st = standing(m.info);
          return (
            <div key={m.name}>
              <LedgerRowBody>
                <Cell label="Name">
                  <span className="num block truncate text-[14px]">{m.name}</span>
                </Cell>
                <Cell label="Role">
                  <span className="block truncate text-ink-2">{m.info?.records?.["hisaab.role"] || "—"}</span>
                </Cell>
                <Cell label="Expiry">
                  <span className="num text-sm">{m.info?.expiry ? longDate(m.info.expiry) : "—"}</span>
                </Cell>
                <Cell label="Status">
                  <span className={cn("inline-block border px-2 py-0.5 text-[12px] font-medium capitalize", STANDING[st])}>{st}</span>
                </Cell>
                <Cell className="md:flex md:justify-end">
                  <div className="flex justify-end gap-1">
                    {st === "active" && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(editing === m.name ? null : m.name)} disabled={r.busy}>
                          <Pencil /> Edit
                        </Button>
                        {confirm === m.name ? (
                          <Button variant="danger" size="sm" onClick={() => revoke(m)} disabled={r.busy}>
                            Confirm
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setConfirm(m.name)} disabled={r.busy}>
                            <UserX /> Revoke
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </Cell>
              </LedgerRowBody>
              {editing === m.name && <EditRow member={m} from={from} runner={r} onDone={() => (setEditing(null), refresh())} />}
            </div>
          );
        })}
      </Ledger>

      <AddMember company={company} teams={teams} resolver={root?.resolver ?? members.find((m) => m.info?.resolver)?.info?.resolver ?? null} from={from} runner={r} onDone={refresh} />

      {(r.steps || r.error) && (
        <div className="mt-6 border border-rule bg-card p-4">
          <TxProgress steps={r.steps ?? []} error={r.error} urlFor={cfg?.local ? () => undefined : (h) => `https://sepolia.etherscan.io/tx/${h}`} />
        </div>
      )}
    </div>
  );
}

type Runner = ReturnType<typeof useTxRunner>;

function EditRow({ member, from, runner, onDone }: { member: Member; from: () => string; runner: Runner; onDone: () => void }) {
  const [role, setRole] = useState(member.info?.records?.["hisaab.role"] ?? "");
  const [expiry, setExpiry] = useState(member.info?.expiry ? toDate(Number(member.info.expiry)) : toDate(Math.floor(Date.now() / 1000) + 180 * day));
  const oldRole = member.info?.records?.["hisaab.role"] ?? "";
  const oldExpiry = member.info?.expiry ? toDate(Number(member.info.expiry)) : "";

  return (
    <form
      className="grid gap-4 border-b border-rule bg-paper-2 px-4 py-4 md:grid-cols-[1fr_200px_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const steps = [];
        if (expiry !== oldExpiry) steps.push({ label: `Set expiry to ${expiry}`, txs: async () => [await ensWrite.modify({ name: member.name, from: from(), expiry: String(toUnix(expiry)) })] });
        if (role.trim() && role.trim() !== oldRole) steps.push({ label: "Update role record", txs: async () => (await api.ensRecords({ name: member.name, from: from(), records: [{ key: "hisaab.role", value: role.trim() }] })).transactions });
        if (steps.length) runner.runSteps(steps, onDone);
      }}
    >
      <Field label="Role">
        <Input value={role} onChange={(e) => setRole(e.target.value)} />
      </Field>
      <Field label="Contract ends">
        <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </Field>
      <Button type="submit" disabled={runner.busy}>
        Save changes
      </Button>
    </form>
  );
}

function AddMember({ company, teams, resolver, from, runner, onDone }: { company: string; teams: string[]; resolver: string | null; from: () => string; runner: Runner; onDone: () => void }) {
  const { cfg } = useHisaab();
  const [team, setTeam] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState("");
  const [expiry, setExpiry] = useState(toDate(Math.floor(Date.now() / 1000) + 180 * day));
  const [wallet, setWallet] = useState("");
  const parent = team || teams[0] || company;
  const name = label ? `${label.toLowerCase()}.${parent}` : "";
  const ok = /^[a-z0-9-]{2,}$/.test(label) && !!role.trim() && (!wallet || /^0x[0-9a-fA-F]{64}$/.test(wallet));

  return (
    <form
      className="mt-10 grid gap-5 border border-rule bg-card p-5 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || !cfg) return;
        const records = [
          { key: "hisaab.registry", value: `${cfg.chainId}:${cfg.registry}` },
          { key: "hisaab.employer", value: company },
          { key: "hisaab.role", value: role.trim() },
          ...(wallet ? [{ key: "hisaab.wallet", value: wallet.toLowerCase() }] : []),
        ];
        runner.runSteps(
          [
            { label: `Issue ${name}`, txs: async () => [await ensWrite.create({ name, from: from(), expiry: String(toUnix(expiry)), resolver: resolver ?? undefined })] },
            { label: "Write employer, role and registry records", txs: async () => (await api.ensRecords({ name, from: from(), records })).transactions },
          ],
          () => {
            trackName(company, name);
            setLabel("");
            setRole("");
            setWallet("");
            onDone();
          },
        );
      }}
    >
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-accent" />
        <h2 className="title">Add a person</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Team">
          <select value={parent} onChange={(e) => setTeam(e.target.value)} className="num h-11 rounded-sm border border-rule-strong bg-card px-3 text-[14px] outline-none focus:border-accent">
            {(teams.length ? teams : [company]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name label" hint={name || "e.g. meera"}>
          <Input value={label} onChange={(e) => setLabel(e.target.value.trim().toLowerCase())} className="num" placeholder="meera" />
        </Field>
        <Field label="Role">
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Backend Engineer, contract" />
        </Field>
        <Field label="Contract ends">
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <Field label="Their sealed wallet (optional)" hint="They create it on their ENS records page; it links the name to their wallet without publishing it." className="md:col-span-2">
          <Input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} className="num" placeholder="0x… (32 bytes)" />
        </Field>
      </div>
      <Button type="submit" disabled={!ok || runner.busy} className="justify-self-start">
        Issue name
      </Button>
    </form>
  );
}
