"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Building2, ReceiptText, ShieldCheck } from "lucide-react";
import { useHisaab } from "@/lib/hisaab";
import { useProfile, type Role } from "@/lib/profile";
import { middle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Brand } from "@/components/Brand";
import { IdentitySwitch } from "@/components/AppShell";
import { Field, Input } from "@/components/ui/input";
import { PdfDropZone } from "@/components/PdfDropZone";

const ROLES: { role: Role; title: string; text: string; Icon: typeof Building2 }[] = [
  { role: "corporate", title: "Corporation", text: "Issue ENS subnames to your people, revoke them when they leave, and pay every invoice that names your wallet.", Icon: Building2 },
  { role: "freelancer", title: "Freelancer", text: "Bill clients in USDT, get paid without them holding gas, and prove every payment to your CA.", Icon: ReceiptText },
];

const rootOf = (name?: string) => (name ? name.split(".").slice(-2).join(".") : "");

export function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const { cfg, identity } = useHisaab();
  const { me, profile, signIn, loggedIn } = useProfile();
  const [role, setRole] = useState<Role>("freelancer");
  const [ens, setEns] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [verifyId, setVerifyId] = useState("");
  const next = params.get("next") || "/dashboard";

  useEffect(() => {
    if (profile) {
      setRole(profile.role);
      setEns(profile.ens);
      setName(profile.name);
      setEditing(false);
      return;
    }
    const corporate = identity?.persona === "company";
    setRole(corporate ? "corporate" : "freelancer");
    setEns(corporate ? rootOf(identity?.ens) : identity?.ens ?? "");
    setName(identity?.legalName ?? "");
    setEditing(true);
  }, [profile, identity?.key, identity?.persona, identity?.ens, identity?.legalName]);

  useEffect(() => {
    if (loggedIn && params.get("next")) router.replace(next);
  }, [loggedIn, next, params, router]);

  const valid = !!me && ens.trim().endsWith(".eth") && name.trim().length > 0;
  const enter = () => {
    if (!valid) return;
    signIn({ role, ens: ens.trim().toLowerCase(), name: name.trim() });
    router.push(next);
  };

  return (
    <div className="grid-bg relative min-h-[calc(100dvh-64px)] overflow-hidden">
      <div aria-hidden className="hero-glow pointer-events-none absolute top-[-20%] left-[-10%] h-[70%] w-[60%] rounded-full bg-[radial-gradient(closest-side,rgb(245_182_42/0.12),transparent)] blur-2xl" />
      <div className="relative mx-auto grid max-w-[1200px] gap-10 px-4 py-12 md:grid-cols-[1.25fr_1fr] md:px-6 md:py-16">
        <section className="border border-rule bg-card/90 p-6 backdrop-blur md:p-8">
          <div className="label text-accent">Step 1 · wallet</div>
          <h1 className="display mt-2">
            Log in to <Brand className="normal-case" />
          </h1>
          <p className="mt-2 text-ink-2">Your wallet is your account. Nothing is stored on a server: your role and ENS name stay in this browser.</p>
          <div className="mt-5">
            <IdentitySwitch />
            {cfg && !cfg.local && !me && <p className="mt-2 text-sm text-ink-3">Use MetaMask or Rabby on Whitechain Sepolia (1874).</p>}
          </div>

          <div className="mt-8 label text-accent">Step 2 · account</div>
          {profile && !editing ? (
            <div className="mt-3 grid gap-4 border border-rule-strong bg-paper-2 p-5">
              <div className="flex items-center gap-3">
                {profile.role === "corporate" ? <Building2 className="size-5 text-accent" /> : <ReceiptText className="size-5 text-accent" />}
                <div className="min-w-0">
                  <div className="font-semibold">{profile.name}</div>
                  <div className="num truncate text-sm text-ink-3">
                    {profile.ens} · {middle(me)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => (signIn(profile), router.push(next))} className="flex h-11 items-center gap-2 bg-accent px-5 font-semibold text-accent-ink hover:bg-accent-2">
                  Continue as {profile.role === "corporate" ? "corporation" : "freelancer"} <ArrowRight className="size-4" />
                </button>
                <button onClick={() => setEditing(true)} className="h-11 border border-rule-strong px-5 text-sm text-ink-2 hover:text-ink">
                  Change account
                </button>
              </div>
            </div>
          ) : (
            <form
              className="mt-3 grid gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                enter();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {ROLES.map(({ role: r, title, text, Icon }) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setRole(r)}
                    aria-pressed={role === r}
                    className={cn("grid gap-2 border p-4 text-left transition-colors", role === r ? "border-accent bg-accent/[0.07]" : "border-rule-strong hover:border-ink-3")}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className={cn("size-4", role === r ? "text-accent" : "text-ink-3")} />
                      <span className="title">{title}</span>
                    </span>
                    <span className="text-sm text-ink-2">{text}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={role === "corporate" ? "Company ENS name" : "Your ENS name"} hint={role === "corporate" ? "e.g. acme-labs.eth" : "e.g. ravi-dev.eth or acme-q4.ravi-dev.eth"}>
                  <Input value={ens} onChange={(e) => setEns(e.target.value.trim())} className="num" placeholder="name.eth" />
                </Field>
                <Field label={role === "corporate" ? "Company name" : "Your legal name"}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
              <button type="submit" disabled={!valid} className="flex h-12 items-center justify-center gap-2 bg-accent font-semibold text-accent-ink hover:bg-accent-2 disabled:opacity-40">
                {profile ? "Save and continue" : role === "corporate" ? "Sign up as a corporation" : "Sign up as a freelancer"} <ArrowRight className="size-4" />
              </button>
              {!me && <p className="text-sm text-warn">Connect a wallet first.</p>}
            </form>
          )}
        </section>

        <section className="grid content-start gap-5 border border-rule bg-card/90 p-6 backdrop-blur md:p-8">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-accent" />
            <h2 className="title">Verify an invoice</h2>
          </div>
          <p className="text-ink-2">No account or wallet needed. Type the invoice number for the public facts, or drop the sealed PDF and enter its key to see who it is between.</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d+$/.test(verifyId)) router.push(`/verify/${verifyId}`);
            }}
          >
            <Input inputMode="numeric" placeholder="Invoice #" value={verifyId} onChange={(e) => setVerifyId(e.target.value.replace(/\D/g, ""))} className="num" aria-label="Invoice number" />
            <button type="submit" className="h-11 shrink-0 border border-rule-strong px-5 text-sm font-medium hover:border-accent hover:text-accent">
              Verify
            </button>
          </form>
          <PdfDropZone
            onResult={(r) => {
              if (r.exists && r.sealedDocument) {
                try {
                  sessionStorage.setItem(`hisaab:sealed:${r.id}`, JSON.stringify(r.sealedDocument));
                } catch {}
              }
              router.push(`/verify/${r.id}`);
            }}
          />
        </section>
      </div>
    </div>
  );
}
