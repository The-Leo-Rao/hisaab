import {
  BaseError,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { registryAbi } from "./abi";
import type { RelayRequest, RelayResponse } from "./gasless";
import { createHisaab, isPayable, remaining } from "./registry";

export type RelayConfig = {
  chain: Chain;
  rpcUrl?: string;
  relayerKey: Hex;
  registry: Address;
  usdt: Address;
  gasCap?: bigint;
  maxFeePerGasCeiling?: bigint;
  minRelayerBalance?: bigint;
  rateLimit?: { max: number; windowMs: number };
  maxTtlSeconds?: number;
};

export type RelayResult = { status: number; body: RelayResponse };

type Parsed = {
  id: bigint;
  from: Address;
  amount: bigint;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  signature: Hex;
};

const digits = (v: unknown) => typeof v === "string" && /^\d{1,78}$/.test(v);

function parse(raw: unknown, maxTtl: number): Parsed {
  const r = (raw ?? {}) as Partial<RelayRequest>;
  if (!digits(r.id) || !digits(r.amount) || !digits(r.validBefore)) throw new Error("id, amount, validBefore must be integer strings");
  if (r.validAfter !== undefined && !digits(r.validAfter)) throw new Error("validAfter must be an integer string");
  if (typeof r.from !== "string" || !isAddress(r.from)) throw new Error("from must be an address");
  if (!isHex(r.salt) || r.salt.length !== 66) throw new Error("salt must be 32 bytes");
  if (!isHex(r.signature) || r.signature.length < 132) throw new Error("bad signature");
  const p: Parsed = {
    id: BigInt(r.id!),
    from: r.from,
    amount: BigInt(r.amount!),
    validAfter: BigInt(r.validAfter ?? "0"),
    validBefore: BigInt(r.validBefore!),
    salt: r.salt,
    signature: r.signature,
  };
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (p.amount === 0n) throw new Error("amount must be > 0");
  if (p.validBefore <= now || p.validBefore > now + BigInt(maxTtl)) throw new Error("validBefore out of range");
  return p;
}

function reason(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : String(e);
}

export function createRelayer(cfg: RelayConfig) {
  const transport = http(cfg.rpcUrl);
  const pub = createPublicClient({ chain: cfg.chain, transport });
  const account = privateKeyToAccount(cfg.relayerKey);
  const wallet = createWalletClient({ chain: cfg.chain, transport, account });
  const hisaab = createHisaab(pub, { registry: cfg.registry, receipt: zeroAddress, usdt: cfg.usdt, deployBlock: 0n });

  const gasCap = cfg.gasCap ?? 300_000n;
  const minBalance = cfg.minRelayerBalance ?? 0n;
  const { max, windowMs } = cfg.rateLimit ?? { max: 5, windowMs: 10 * 60_000 };
  const maxTtl = cfg.maxTtlSeconds ?? 3600;
  const hits = new Map<string, number[]>();

  function limited(key: string): boolean {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const over = recent.length >= max;
    if (!over) recent.push(now);
    hits.set(key, recent);
    return over;
  }

  const fail = (check: number, status: number, error: string): RelayResult => ({ status, body: { ok: false, check, error } });

  async function handle(raw: unknown, ip: string): Promise<RelayResult> {
    let p: Parsed;
    try {
      p = parse(raw, maxTtl);
    } catch (e) {
      return fail(0, 400, reason(e));
    }

    if (limited(`ip:${ip}`) || limited(`from:${p.from.toLowerCase()}`)) return fail(5, 429, "too many requests, try again later");

    const inv = await hisaab.getInvoice(p.id);
    if (!inv || !isPayable(inv) || p.amount > remaining(inv)) return fail(1, 400, "invoice is not payable for that amount");

    if (inv.client !== zeroAddress && inv.client.toLowerCase() !== p.from.toLowerCase()) {
      return fail(2, 403, "signer is not the invoice client");
    }

    if ((await hisaab.usdtBalance(p.from)) < p.amount) return fail(3, 400, "insufficient USDT balance");

    const call = {
      address: cfg.registry,
      abi: registryAbi,
      functionName: "payWithAuthorization",
      args: [p.id, p.from, p.amount, p.validAfter, p.validBefore, p.salt, p.signature],
      account,
    } as const;

    let gas: bigint;
    try {
      await pub.simulateContract(call);
      gas = await pub.estimateContractGas(call);
    } catch (e) {
      return fail(4, 400, reason(e));
    }

    if (gas > gasCap) return fail(6, 400, "gas above cap");
    if (cfg.maxFeePerGasCeiling !== undefined) {
      const price = await pub.estimateFeesPerGas().then((f) => f.maxFeePerGas ?? 0n, () => pub.getGasPrice());
      if (price > cfg.maxFeePerGasCeiling) return fail(6, 503, "network gas price too high, pay with wallet");
    }

    if ((await pub.getBalance({ address: account.address })) <= minBalance) {
      return fail(7, 503, "relayer budget exhausted, pay with wallet");
    }

    try {
      const txHash = await wallet.writeContract({ ...call, chain: cfg.chain, gas: (gas * 12n) / 10n });
      return { status: 200, body: { ok: true, txHash } };
    } catch (e) {
      return fail(4, 502, reason(e));
    }
  }

  return { handle, address: account.address };
}

export type Relayer = ReturnType<typeof createRelayer>;
