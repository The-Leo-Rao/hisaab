import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { namehash, normalize } from "viem/ens";
import type { InvoiceDoc } from "./invoice";
import type { Signer } from "./registry";

export const ZERO32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function ensNode(name: string): Hex {
  if (!name) return ZERO32;
  try {
    return namehash(normalize(name));
  } catch {
    return namehash(name);
  }
}

const b32 = (salt: Hex) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new Error("salt must be 32 bytes");
  return salt;
};

export const issuerCommitment = (name: string, salt: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [ensNode(name), b32(salt)]));

export const walletCommitment = (wallet: Address, nameSalt: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [wallet, b32(nameSalt)]));

export const approvalCommitment = (id: bigint, salt: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [id, b32(salt)]));

export const nameSecretMessage = (name: string) =>
  `Hisaab name secret for ${name}\n\nThis signature stays in your browser. It does not move funds.`;

export async function deriveNameSalt(wallet: Signer, name: string): Promise<Hex> {
  const sig = await wallet.signMessage({ account: wallet.account, message: nameSecretMessage(name) });
  return keccak256(sig);
}

export function nameSaltOf(doc: InvoiceDoc): Hex | null {
  const s = doc.supplier?.nameSalt;
  return typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s) ? (s as Hex) : null;
}
