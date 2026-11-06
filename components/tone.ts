import type { Tone } from "@/lib/api";

export type State = "idle" | "ok" | "warn" | "bad";

export const fromTone = (t: Tone): State => (t === "green" ? "ok" : t === "amber" ? "warn" : t === "red" ? "bad" : "idle");

export const toneText: Record<State, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", idle: "text-idle" };
export const toneBorder: Record<State, string> = { ok: "border-ok/60", warn: "border-warn/60", bad: "border-bad/60", idle: "border-idle/50" };
export const toneSoft: Record<State, string> = { ok: "bg-ok-fill/10", warn: "bg-warn-fill/15", bad: "bg-bad-fill/10", idle: "bg-idle-fill/15" };
export const toneFill: Record<State, string> = { ok: "bg-ok-fill", warn: "bg-warn-fill", bad: "bg-bad-fill", idle: "bg-idle-fill" };
export const toneHex: Record<State, string> = { ok: "#34d399", warn: "#fbbf24", bad: "#f87171", idle: "#a3a9b6" };
export const toneWord: Record<State, string> = { ok: "Pass", warn: "Check", bad: "Fail", idle: "Not checked" };
