"use client";

import { useCallback, useEffect, useState } from "react";
import { parseAbi, parseAbiItem, zeroAddress, type Address, type PublicClient } from "viem";
import { useHisaab } from "@/lib/hisaab";
import { api, type EnsName } from "@/lib/api";

const ETH_REGISTRY: Address = "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4";
const registryAbi = parseAbi(["function getSubregistry(string label) view returns (address)"]);
const LabelRegistered = parseAbiItem("event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)");
const LOOKBACK = 9_000n;

const trackKey = (company: string) => `hisaab:tracked:${company.toLowerCase()}`;

export function trackedNames(company: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(trackKey(company)) ?? "[]");
  } catch {
    return [];
  }
}

export function trackName(company: string, name: string) {
  const list = new Set(trackedNames(company));
  list.add(name.toLowerCase());
  try {
    localStorage.setItem(trackKey(company), JSON.stringify([...list]));
  } catch {}
}

async function labels(client: PublicClient, registry: Address): Promise<string[]> {
  const latest = await client.getBlockNumber();
  const logs = await client.getLogs({ address: registry, event: LabelRegistered, fromBlock: latest > LOOKBACK ? latest - LOOKBACK : 0n, toBlock: latest });
  return [...new Set(logs.map((l) => l.args.label).filter((x): x is string => !!x))];
}

const sub = (client: PublicClient, registry: Address, label: string) =>
  client.readContract({ address: registry, abi: registryAbi, functionName: "getSubregistry", args: [label] });

export async function discover(client: PublicClient, company: string): Promise<{ teams: string[]; members: string[] }> {
  const root = company.split(".")[0];
  const reg = await sub(client, ETH_REGISTRY, root);
  if (reg === zeroAddress) return { teams: [], members: [] };
  const teams: string[] = [];
  const members: string[] = [];
  for (const label of await labels(client, reg).catch(() => [])) {
    const name = `${label}.${company}`;
    const child = await sub(client, reg, label).catch(() => zeroAddress);
    if (child === zeroAddress) {
      members.push(name);
      continue;
    }
    teams.push(name);
    for (const m of await labels(client, child).catch(() => [])) members.push(`${m}.${name}`);
  }
  return { teams, members };
}

export type Member = { name: string; info: EnsName | null };

export function useSubnames(company: string | undefined, refresh: number) {
  const { cfg } = useHisaab();
  const [state, setState] = useState<{ teams: string[]; members: Member[]; loading: boolean; error: string | null }>({ teams: [], members: [], loading: true, error: null });

  const load = useCallback(async () => {
    if (!cfg || !company) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const found = await discover(cfg.sepoliaClient, company).catch(() => ({ teams: [], members: [] }));
      const team = new Set(found.teams);
      found.members.forEach((m) => trackName(company, m));
      const names = [...new Set([...found.members, ...trackedNames(company)])].filter((n) => !team.has(n));
      const infos = await Promise.all(names.map((n) => api.ensName(n).catch(() => null)));
      const teams = found.teams.length ? found.teams : [...new Set(names.map((n) => n.split(".").slice(1).join(".")).filter((t) => t.split(".").length >= 3))];
      setState({ teams, members: names.map((name, i) => ({ name, info: infos[i] })), loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [cfg, company]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  return state;
}
