import { network, sepoliaRpc } from "@/lib/server/network";

export const dynamic = "force-dynamic";

const BLOCKED = /^(anvil_|hardhat_|evm_|debug_|admin_|personal_)/;

export async function POST(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  const n = network();
  const target = chain === "whitechain" ? n?.rpcUrl : chain === "sepolia" ? sepoliaRpc() : undefined;
  if (!target) return Response.json({ error: "unknown chain" }, { status: 404 });
  const text = await req.text();
  if (text.length > 512_000) return Response.json({ error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (!n?.local && calls.some((c) => typeof c?.method === "string" && BLOCKED.test(c.method))) {
    return Response.json({ error: "method not allowed" }, { status: 403 });
  }
  const res = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: text, cache: "no-store" });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
