import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { randomSalt } from "./invoice";
import type { Signer } from "./registry";

export const USDT_DOMAIN = { name: "Tether USD", version: "1" } as const;

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type RelayRequest = {
  id: string;
  from: Address;
  amount: string;
  validAfter?: string;
  validBefore: string;
  salt: Hex;
  signature: Hex;
};

export type RelayResponse = { ok: true; txHash: Hex } | { ok: false; check: number; error: string };

export function authorizationNonce(
  chainId: number,
  registry: Address,
  id: bigint,
  from: Address,
  amount: bigint,
  salt: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint128" },
        { type: "bytes32" },
      ],
      [BigInt(chainId), registry, id, from, amount, salt],
    ),
  );
}

export async function signGaslessPayment(
  wallet: Signer,
  p: {
    registry: Address;
    usdt: Address;
    id: bigint;
    amount: bigint;
    ttlSeconds?: number;
    domain?: { name: string; version: string };
  },
): Promise<RelayRequest> {
  const from = wallet.account.address;
  const chainId = wallet.chain.id;
  const salt = randomSalt();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + (p.ttlSeconds ?? 600));
  const nonce = authorizationNonce(chainId, p.registry, p.id, from, p.amount, salt);
  const signature = await wallet.signTypedData({
    account: wallet.account,
    domain: { ...(p.domain ?? USDT_DOMAIN), chainId, verifyingContract: p.usdt },
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from, to: p.registry, value: p.amount, validAfter: 0n, validBefore, nonce },
  });
  return {
    id: p.id.toString(),
    from,
    amount: p.amount.toString(),
    validAfter: "0",
    validBefore: validBefore.toString(),
    salt,
    signature,
  };
}

export async function submitToRelay(url: string, req: RelayRequest): Promise<{ txHash: Hex }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<RelayResponse> & { error?: string };
  if (!res.ok || body.ok !== true) throw new Error(body.error ?? `relay failed (${res.status})`);
  return { txHash: (body as { txHash: Hex }).txHash };
}
