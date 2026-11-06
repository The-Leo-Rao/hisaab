import { toBytes, type Hex } from "viem";
import { b64url, docHash, fromB64url, type InvoiceDoc } from "./invoice";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const KEY_CHARS = 26;
export const SEAL_ALG = "A256GCM-HKDF-SHA256";

const raw = (u: Uint8Array) => new Uint8Array(u);

export type InvoiceKey = { id: bigint | null; secret: string };

export type SealedInvoice = {
  v: 1;
  alg: typeof SEAL_ALG;
  id: string;
  docHash: Hex;
  iv: string;
  ct: string;
};

export function formatInvoiceKey(id: bigint, secret: string): string {
  const groups = secret.match(/.{1,4}/g) ?? [];
  return `HSB${id}-${groups.join("-")}`;
}

export function generateInvoiceKey(id: bigint): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_CHARS));
  const secret = Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
  return formatInvoiceKey(id, secret);
}

export function parseInvoiceKey(input: string): InvoiceKey | null {
  const raw = String(input ?? "").toUpperCase().replace(/\s+/g, "");
  const m = raw.match(/^(?:HSB(\d+)-)?([0-9A-Z-]+)$/);
  if (!m) return null;
  const body = m[2].replace(/-/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (body.length !== KEY_CHARS || [...body].some((c) => !ALPHABET.includes(c))) return null;
  return { id: m[1] ? BigInt(m[1]) : null, secret: body };
}

async function aesKey(secret: string, hash: Hex, id: bigint): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: raw(toBytes(hash)), info: enc.encode(`hisaab/seal/v1/${id}`) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function keyFor(input: string, id: bigint): string {
  const k = parseInvoiceKey(input);
  if (!k) throw new Error("That doesn't look like a Hisaab invoice key.");
  if (k.id !== null && k.id !== id) throw new Error(`This key belongs to invoice #${k.id}, not #${id}.`);
  return k.secret;
}

export async function sealInvoice(doc: InvoiceDoc, id: bigint, key: string): Promise<SealedInvoice> {
  const hash = docHash(doc);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await aesKey(keyFor(key, id), hash, id);
  const plain = new TextEncoder().encode(JSON.stringify(doc));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: raw(toBytes(hash)) }, k, plain));
  return { v: 1, alg: SEAL_ALG, id: id.toString(), docHash: hash, iv: b64url(iv), ct: b64url(ct) };
}

export function isSealedInvoice(x: unknown): x is SealedInvoice {
  const s = x as SealedInvoice;
  return !!s && s.v === 1 && s.alg === SEAL_ALG && /^\d+$/.test(s.id) && /^0x[0-9a-fA-F]{64}$/.test(s.docHash) && typeof s.iv === "string" && typeof s.ct === "string";
}

export async function openInvoice(sealed: SealedInvoice, key: string): Promise<InvoiceDoc> {
  if (!isSealedInvoice(sealed)) throw new Error("Not a sealed Hisaab invoice.");
  const id = BigInt(sealed.id);
  const k = await aesKey(keyFor(key, id), sealed.docHash, id);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw(fromB64url(sealed.iv)), additionalData: raw(toBytes(sealed.docHash)) },
      k,
      raw(fromB64url(sealed.ct)),
    );
  } catch {
    throw new Error("Wrong key for this invoice.");
  }
  const doc = JSON.parse(new TextDecoder().decode(plain)) as InvoiceDoc;
  if (docHash(doc).toLowerCase() !== sealed.docHash.toLowerCase()) throw new Error("The sealed invoice was altered.");
  return doc;
}
