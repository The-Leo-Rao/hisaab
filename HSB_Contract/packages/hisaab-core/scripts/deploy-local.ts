import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getContractAddress,
  http,
  keccak256,
  pad,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { chainFor } from "../src/chains";
import { usdtAbi } from "../src/registry";

const MNEMONIC = "test test test test test test test test test test test junk";
const rpcUrl = process.env.ANVIL_RPC ?? "http://127.0.0.1:8545";
const verifyBase = process.env.VERIFY_BASE ?? "http://localhost:3000/verify/";
const existingUsdt = process.env.USDT as Address | undefined;
const FUND = parseUnits("100000", 6);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const out = join(root, "contracts/out");

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(join(out, `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

const probe = createPublicClient({ transport: http(rpcUrl) });
const chain = chainFor(await probe.getChainId(), rpcUrl);
const account = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
const devAddress = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i }).address;

async function deploy(name: string, args: unknown[]): Promise<Address> {
  const { abi, bytecode } = artifact(name);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (!r.contractAddress) throw new Error(`${name} deploy failed`);
  return r.contractAddress;
}

async function balanceSlot(token: Address): Promise<bigint> {
  const who = devAddress(1);
  const marker = 123_456_789n;
  for (let slot = 0n; slot < 200n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, slot]));
    const before = await pub.getStorageAt({ address: token, slot: key });
    await pub.request({ method: "anvil_setStorageAt" as never, params: [token, key, pad(toHex(marker))] as never });
    const bal = await pub.readContract({ address: token, abi: usdtAbi, functionName: "balanceOf", args: [who] });
    await pub.request({ method: "anvil_setStorageAt" as never, params: [token, key, before ?? pad("0x0")] as never });
    if (bal === marker) return slot;
  }
  throw new Error("could not find the token balance slot");
}

async function fundExisting(token: Address) {
  const slot = await balanceSlot(token);
  for (let i = 1; i <= 8; i++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [devAddress(i), slot]));
    await pub.request({ method: "anvil_setStorageAt" as never, params: [token, key, pad(toHex(FUND))] as never });
  }
}

async function mintMock(token: Address) {
  for (let i = 1; i <= 8; i++) {
    const hash = await wallet.writeContract({ address: token, abi: usdtAbi, functionName: "mint", args: [devAddress(i), FUND] });
    await pub.waitForTransactionReceipt({ hash });
  }
}

const startNonce = await pub.getTransactionCount({ address: account.address });
const usdt = existingUsdt ?? (await deploy("MockUSDT", []));
const nonce = await pub.getTransactionCount({ address: account.address });
const predicted = getContractAddress({ from: account.address, nonce: BigInt(nonce + 1) });
const receipt = await deploy("HisaabReceipt", [predicted, verifyBase]);
const registry = await deploy("HisaabRegistry", [usdt, receipt]);
if (registry.toLowerCase() !== predicted.toLowerCase()) throw new Error("registry address mismatch");
const deployBlock = await pub.getBlockNumber();

if (existingUsdt) await fundExisting(usdt);
else await mintMock(usdt);

const relayerKey = toHex(mnemonicToAccount(MNEMONIC, { addressIndex: 9 }).getHdKey().privateKey!);
const result = {
  chainId: chain.id,
  rpcUrl,
  registry,
  receipt,
  usdt,
  usdtIsMock: !existingUsdt,
  deployBlock: deployBlock.toString(),
  verifyBase,
  relayerKey,
};
writeFileSync(join(root, ".deploy.local.json"), JSON.stringify(result, null, 2));

console.log(`CHAIN     ${chain.id} (${chain.name})`);
console.log(`USDT      ${usdt}${existingUsdt ? " (existing token)" : " (MockUSDT)"}`);
console.log(`RECEIPT   ${receipt}`);
console.log(`REGISTRY  ${registry}`);
console.log(`BLOCK     ${deployBlock} (deployer nonce started at ${startNonce})`);
console.log(`Funded dev accounts 1-8 with 100,000 USDT${existingUsdt ? " via storage write" : ""}. Wrote .deploy.local.json`);
