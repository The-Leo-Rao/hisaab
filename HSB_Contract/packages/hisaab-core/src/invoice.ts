import canonicalize from "canonicalize";
import { formatUnits, keccak256, parseUnits, toBytes, toHex, type Address, type Hex } from "viem";

export const USDT_DECIMALS = 6;
export const SCHEMA = "hisaab.invoice/1";

export type Party = { legalName: string; ens?: string; wallet?: Address; [k: string]: unknown };
export type Line = { description: string; qty: number; unitPrice: string; amount: string; [k: string]: unknown };
export type Engagement = {
  kind: "freelance" | "contract-employee";
  employer?: string;
  role?: string;
  periodFrom?: string;
  periodTo?: string;
};
export type InvoiceDoc = {
  schema: typeof SCHEMA;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  supplier: Party;
  customer: Party;
  lines: Line[];
  currency: "USDT";
  subtotal: string;
  total: string;
  settlement: { chainId: number; registry: Address; token: Address; amountUnits: string };
  engagement?: Engagement;
  salt: Hex;
  [k: string]: unknown;
};

export function canonical(doc: object): string {
  const s = canonicalize(doc);
  if (s === undefined) throw new Error("invoice is not canonicalizable");
  return s;
}

export function docHash(doc: object): Hex {
  return keccak256(toBytes(canonical(doc)));
}

export function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export const toUnits = (amount: string): bigint => parseUnits(amount, USDT_DECIMALS);

export function formatMoney(units: bigint): string {
  const [whole, frac = ""] = formatUnits(units, USDT_DECIMALS).split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

export function lineAmount(qty: number, unitPrice: string): bigint {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("qty must be a positive integer");
  return toUnits(unitPrice) * BigInt(qty);
}

export type BuildInput = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  supplier: Party;
  customer: Party;
  lines: { description: string; qty: number; unitPrice: string }[];
  settlement: { chainId: number; registry: Address; token: Address };
  engagement?: Engagement;
  extra?: Record<string, unknown>;
  salt?: Hex;
};

export function buildInvoice(i: BuildInput): InvoiceDoc {
  if (i.lines.length === 0) throw new Error("at least one line");
  const lines = i.lines.map((l) => {
    const units = lineAmount(l.qty, l.unitPrice);
    return { description: l.description, qty: l.qty, unitPrice: formatMoney(toUnits(l.unitPrice)), amount: formatMoney(units) };
  });
  const total = i.lines.reduce((s, l) => s + lineAmount(l.qty, l.unitPrice), 0n);
  if (total === 0n) throw new Error("total must be > 0");
  const doc: InvoiceDoc = {
    ...i.extra,
    schema: SCHEMA,
    invoiceNumber: i.invoiceNumber,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    supplier: i.supplier,
    customer: i.customer,
    lines,
    currency: "USDT",
    subtotal: formatMoney(total),
    total: formatMoney(total),
    settlement: { ...i.settlement, amountUnits: total.toString() },
    salt: i.salt ?? randomSalt(),
  };
  if (i.engagement) doc.engagement = i.engagement;
  return JSON.parse(JSON.stringify(doc));
}

export const totalUnits = (doc: InvoiceDoc): bigint => BigInt(doc.settlement.amountUnits);

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([new Uint8Array(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeFragment(doc: object): Promise<string> {
  const gz = await pipe(new TextEncoder().encode(canonical(doc)), new CompressionStream("gzip"));
  return `d=${b64url(gz)}`;
}

export async function decodeFragment(fragment: string): Promise<InvoiceDoc | null> {
  const d = new URLSearchParams(fragment.replace(/^#/, "")).get("d");
  if (!d) return null;
  const raw = await pipe(fromB64url(d), new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(raw)) as InvoiceDoc;
}

export async function payLink(appBase: string, id: bigint, doc: object, key?: string): Promise<string> {
  const k = key ? `&k=${encodeURIComponent(key)}` : "";
  return `${appBase.replace(/\/$/, "")}/pay/${id}#${await encodeFragment(doc)}${k}`;
}

export function keyFromFragment(fragment: string): string | null {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("k");
}

export function parseLink(link: string): { id: bigint; fragment: string } {
  const u = new URL(link);
  const m = u.pathname.match(/\/pay\/(\d+)\/?$/);
  if (!m) throw new Error("not a Hisaab pay link");
  return { id: BigInt(m[1]), fragment: u.hash };
}
