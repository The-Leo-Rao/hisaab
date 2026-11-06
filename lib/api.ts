import type { InvoiceDoc } from "@hisaab/core";

export const API = "/hisaab-api";

export type Tone = "green" | "amber" | "red" | "grey";

export type Check = {
  key: "hash" | "issuer" | "standing" | "payment" | "client";
  label: string;
  tone: Tone;
  text: string;
  evidence: Record<string, unknown>;
};

export type EnsName = {
  name: string;
  valid: boolean;
  status: string;
  owner?: string | null;
  expiry?: string | null;
  resolver?: string | null;
  registry?: string;
  node?: string;
  records?: Record<string, string | null>;
  addr?: string | null;
  wallet?: string | null;
  revoked?: boolean;
  reason?: string;
};

export type ApiInvoice = {
  id: string;
  issuer: string;
  client: string;
  payer: string;
  amount: string;
  paid: string;
  refunded: string;
  createdAt: string;
  dueDate: string;
  paidAt: string;
  status: "Open" | "PartiallyPaid" | "Paid" | "Cancelled" | "Refunded";
  docHash: string;
  issuerNode: string;
  supersedes: string;
  issuerName: string;
  clientName: string;
  amountText: string;
  paidText: string;
  refundedText: string;
};

export type ApiPayment = { payer: string; amount: string; totalPaid: string; gasless: boolean; txHash: string; blockNumber: string; explorer: string };
export type ApiRefund = { to: string; amount: string; txHash: string; explorer: string };

export type VerifyResult =
  | { id: string; exists: false }
  | {
      id: string;
      exists: true;
      verified: boolean;
      kind: "freelance" | "contractor";
      summary: string | null;
      checks: Check[];
      invoice: ApiInvoice;
      payments: ApiPayment[];
      refunds: ApiRefund[];
      receipt: { exists: boolean; owner: string | null; image: string | null; external_url: string | null };
      ens: { issuer: EnsName; client: EnsName | null };
      chain: { chainId: number; registry: string; receipt: string; usdt: string; explorer: string };
      links: { verify: string };
      checkedAt: string;
      document?: InvoiceDoc | null;
      source?: "pdf" | "json" | "none";
    };

export type UnsignedTx = {
  action: string;
  name: string;
  from: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
  key?: string;
  recordValue?: string;
};

async function call<T>(path: string, body?: unknown, ok404 = false): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok && !(ok404 && res.status === 404)) throw new Error(j.error || `The verification service answered ${res.status}.`);
  return j as T;
}

export const api = {
  verify: (id: string) => call<VerifyResult>(`/verify/${id}`, undefined, true),
  verifyWith: (body: { id?: string; document?: unknown; fragment?: string; pdf?: string }) => call<VerifyResult>("/verify", body, true),
  receipt: (id: string) => call<{ exists: boolean; owner: string; image: string; external_url: string }>(`/receipt/${id}`),
  ensName: (name: string) => call<EnsName>(`/ens/name?name=${encodeURIComponent(name)}`),
  ensRecords: (body: Record<string, unknown>) =>
    call<{ records: { key: string; value: string }[]; via: string; transactions: UnsignedTx[] }>("/ens/records", body),
  clientRole: (body: { name: string; from: string; client: string }) => call<UnsignedTx>("/ens/client-role", body),
  approve: (body: { name: string; from: string; invoiceId: string }) => call<UnsignedTx>("/ens/approve", body),
};

export async function downloadPdf(path: "/statement" | "/invoice-pdf", body: { id: string; document?: unknown }, filename: string) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Could not create the PDF.");
  }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
