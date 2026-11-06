"use client";

import { useEffect, useState } from "react";
import { api, type EnsName } from "@/lib/api";
import { longDate, middle, same } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toneFill, type State } from "./tone";

const cache = new Map<string, Promise<EnsName>>();

export function useEnsName(name?: string | null, refreshKey = 0) {
  const [data, setData] = useState<EnsName | null>(null);
  useEffect(() => {
    if (!name) return setData(null);
    const key = `${name}:${refreshKey}`;
    if (!cache.has(key)) cache.set(key, api.ensName(name).catch(() => ({ name, valid: false, status: "unknown" }) as EnsName));
    let live = true;
    cache.get(key)!.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [name, refreshKey]);
  return data;
}

export function ensState(e: EnsName | null, wallet?: string | null): State {
  if (!e) return "idle";
  if (e.revoked || e.status === "unregistered" || e.status === "available" || !e.valid) return "bad";
  if (e.status === "expired") return "warn";
  if (wallet && e.wallet && !same(e.wallet, wallet)) return "bad";
  return e.status === "registered" ? "ok" : "idle";
}

const stateWord: Record<State, string> = { ok: "active", warn: "expired", bad: "not valid", idle: "checking" };

export function IdentityChip({ name, wallet, className }: { name?: string | null; wallet?: string | null; className?: string }) {
  const ens = useEnsName(name);
  const state = ensState(ens, wallet);
  const records = Object.entries(ens?.records ?? {}).filter(([, v]) => v);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex min-w-0 items-center gap-2 rounded-sm outline-offset-2", className)}>
          {name && <span className={cn("size-2 shrink-0 rounded-full", toneFill[state])} aria-label={`ENS ${stateWord[state]}`} />}
          <span className="truncate font-medium">{name || "No ENS name"}</span>
          {wallet && <span className="num text-sm text-ink-3">{middle(wallet)}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-[13px]">
        {name ? (
          <div className="grid gap-1">
            <div>
              {name} · {ens ? ens.status : "checking…"}
              {ens?.expiry ? ` until ${longDate(ens.expiry)}` : ""}
            </div>
            {records.map(([k, v]) => (
              <div key={k} className="num text-xs opacity-80">
                {k} = {String(v).length > 46 ? middle(String(v), 20, 12) : v}
              </div>
            ))}
          </div>
        ) : (
          <span className="num">{wallet}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
