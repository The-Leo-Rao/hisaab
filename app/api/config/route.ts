import { privateKeyToAccount } from "viem/accounts";
import { demoNames, network } from "@/lib/server/network";

export const dynamic = "force-dynamic";

export function GET() {
  const n = network();
  if (!n) {
    return Response.json(
      { error: "No हिsaab deployment found. Start the local stack (start-demo.ps1) or set HISAAB_NETWORK=whitechain and the contract addresses." },
      { status: 503 },
    );
  }
  const { relayerKey, rpcUrl: _rpc, ...pub } = n;
  return Response.json({
    ...pub,
    relayer: relayerKey ? privateKeyToAccount(relayerKey).address : null,
    demo: n.local ? demoNames() : null,
  });
}
