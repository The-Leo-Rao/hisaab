import { deriveNameSalt, generateInvoiceKey, sealInvoice, type InvoiceDoc, type Signer } from "@hisaab/core";
import type { Hex } from "viem";
import { downloadPdf } from "@/lib/api";
import { loadKey, loadNameSalt, saveKey, saveNameSalt } from "@/lib/store";

export async function nameSaltFor(signer: Signer, name: string): Promise<Hex> {
  const owner = signer.account.address;
  const cached = loadNameSalt(owner, name);
  if (cached) return cached;
  const salt = await deriveNameSalt(signer, name);
  saveNameSalt(owner, name, salt);
  return salt;
}

export function newKey(id: bigint, hash: string): string {
  const key = generateInvoiceKey(id);
  saveKey(hash, key);
  return key;
}

export const keyOf = (hash: string) => loadKey(hash);

export async function downloadSealedPdf(id: bigint | string, doc: InvoiceDoc, key: string) {
  const sealed = await sealInvoice(doc, BigInt(id), key);
  await downloadPdf("/invoice-pdf", { id: String(id), sealed }, `invoice-${id}-sealed.pdf`);
}
