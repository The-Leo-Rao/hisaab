import type { InvoiceDoc } from "@hisaab/core";

function get<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function set(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const saveDoc = (hash: string, doc: InvoiceDoc) => set(`hisaab:doc:${hash.toLowerCase()}`, doc);
export const loadDoc = (hash: string) => get<InvoiceDoc>(`hisaab:doc:${hash.toLowerCase()}`);

export const saveTemplate = <T>(owner: string, mode: string, t: T) => set(`hisaab:last:${mode}:${owner.toLowerCase()}`, t);
export const loadTemplate = <T>(owner: string, mode: string) => get<T>(`hisaab:last:${mode}:${owner.toLowerCase()}`);

export function seenReceipts(): Set<string> {
  return new Set(get<string[]>("hisaab:seen-receipts") ?? []);
}

export function markSeen(ids: string[]) {
  const s = seenReceipts();
  ids.forEach((i) => s.add(i));
  set("hisaab:seen-receipts", [...s]);
}

export const saveKey = (hash: string, key: string) => set(`hisaab:key:${hash.toLowerCase()}`, key);
export const loadKey = (hash: string) => get<string>(`hisaab:key:${hash.toLowerCase()}`);

export const saveNameSalt = (owner: string, name: string, salt: string) => set(`hisaab:namesalt:${owner.toLowerCase()}:${name.toLowerCase()}`, salt);
export const loadNameSalt = (owner: string, name: string) => get<`0x${string}`>(`hisaab:namesalt:${owner.toLowerCase()}:${name.toLowerCase()}`);
