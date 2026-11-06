import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  getContractAddress,
  http,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const MNEMONIC = "test test test test test test test test test test test junk";
const rpcUrl = process.env.ANVIL_RPC ?? "http://127.0.0.1:8545";
const verifyBase = process.env.VERIFY_BASE ?? "http://localhost:5173/verify/";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const out = join(root, "contracts/out");

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(join(out, `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

const account = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
const chain = { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } };
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });

async function deploy(name: string, args: unknown[]): Promise<Address> {
  const { abi, bytecode } = artifact(name);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (!r.contractAddress) throw new Error(`${name} deploy failed`);
  return r.contractAddress;
}

const nonce = await pub.getTransactionCount({ address: account.address });
const predicted = getContractAddress({ from: account.address, nonce: BigInt(nonce + 2) });

const usdt = await deploy("MockUSDT", []);
const receipt = await deploy("HisaabReceipt", [predicted, verifyBase]);
const registry = await deploy("HisaabRegistry", [usdt, receipt]);
if (registry.toLowerCase() !== predicted.toLowerCase()) throw new Error("registry address mismatch");
const deployBlock = await pub.getBlockNumber();

const mintAbi = artifact("MockUSDT").abi;
for (let i = 1; i <= 8; i++) {
  const to = mnemonicToAccount(MNEMONIC, { addressIndex: i }).address;
  const hash = await wallet.writeContract({
    address: usdt,
    abi: mintAbi,
    functionName: "mint",
    args: [to, parseUnits("100000", 6)],
  });
  await pub.waitForTransactionReceipt({ hash });
}

const relayerKey = toHex(mnemonicToAccount(MNEMONIC, { addressIndex: 9 }).getHdKey().privateKey!);
const result = { chainId: chain.id, rpcUrl, registry, receipt, usdt, deployBlock: deployBlock.toString(), relayerKey };
writeFileSync(join(root, ".deploy.local.json"), JSON.stringify(result, null, 2));

console.log(`USDT      ${usdt}`);
console.log(`RECEIPT   ${receipt}`);
console.log(`REGISTRY  ${registry}`);
console.log(`BLOCK     ${deployBlock}`);
console.log("Minted 100,000 USDT to dev accounts 1-8. Wrote .deploy.local.json");
