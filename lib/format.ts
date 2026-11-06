import { formatMoney } from "@hisaab/core";

export function middle(value?: string | null, head = 6, tail = 4): string {
  if (!value) return "—";
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

export function group(decimal: string): string {
  const [w, f] = decimal.split(".");
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f !== undefined ? `${whole}.${f}` : whole;
}

export function usdt(units: bigint | string | number): string {
  return group(formatMoney(BigInt(units)));
}

export function toNumber(units: bigint | string): number {
  return Number(BigInt(units)) / 1e6;
}

export function longDate(ts: bigint | number | string | null | undefined): string {
  const n = Number(ts ?? 0);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function isoDay(ts: bigint | number | string | null | undefined): string {
  const n = Number(ts ?? 0);
  return n ? new Date(n * 1000).toISOString().slice(0, 10) : "—";
}

export const isZero = (a?: string | null) => !a || /^0x0+$/.test(a);
export const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
