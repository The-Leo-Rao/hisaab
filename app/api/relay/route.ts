import { chainFor } from "@hisaab/core";
import { createRelayer, type Relayer } from "@hisaab/core/relay";
import { network, type Network } from "@/lib/server/network";

export const dynamic = "force-dynamic";

const relayers = new Map<string, Relayer>();

function relayerFor(n: Network): Relayer | null {
  if (!n.relayerKey) return null;
  const key = `${n.chainId}:${n.registry}`;
  let r = relayers.get(key);
  if (!r) {
    const env = process.env;
    r = createRelayer({
      chain: chainFor(n.chainId, n.rpcUrl),
      rpcUrl: n.rpcUrl,
      relayerKey: n.relayerKey,
      registry: n.registry,
      usdt: n.usdt,
      rateLimit: { max: Number(env.RELAY_RATE_MAX || (n.local ? 100 : 5)), windowMs: 10 * 60_000 },
      minRelayerBalance: BigInt(env.RELAYER_MIN_WEI || (n.local ? "0" : "10000000000000000")),
      maxFeePerGasCeiling: env.RELAY_MAX_FEE_WEI ? BigInt(env.RELAY_MAX_FEE_WEI) : undefined,
    });
    relayers.set(key, r);
  }
  return r;
}

export async function POST(req: Request) {
  const n = network();
  const relayer = n && relayerFor(n);
  if (!relayer) return Response.json({ ok: false, check: 7, error: "Gasless payments are not configured on this server." }, { status: 503 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, check: 0, error: "Body must be JSON." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const r = await relayer.handle(body, ip);
  return Response.json(r.body, { status: r.status });
}
