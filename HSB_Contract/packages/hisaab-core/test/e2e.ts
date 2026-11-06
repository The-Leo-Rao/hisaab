import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import QR from "qrcode";
import jsQR from "jsqr";
import { createPublicClient, createWalletClient, http, parseEther, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  buildInvoice,
  chainFor,
  createHisaab,
  decodeFragment,
  docHash,
  formatMoney,
  generateInvoiceKey,
  issuerCommitment,
  keyFromFragment,
  openInvoice,
  RECEIPT_SINK,
  sealInvoice,
  parseLink,
  payLink,
  receiptAbi,
  signGaslessPayment,
  toUnits,
  type Signer,
} from "../src";
import { createRelayer } from "../src/relay";

const MNEMONIC = "test test test test test test test test test test test junk";
const file = process.env.DEPLOY_FILE ?? new URL("../../../.deploy.local.json", import.meta.url);
const net = JSON.parse(readFileSync(file, "utf8"));
const chain = chainFor(net.chainId, net.rpcUrl);
const pub = createPublicClient({ chain, transport: http(net.rpcUrl) });
const hisaab = createHisaab(pub, { ...net, deployBlock: BigInt(net.deployBlock) });

const signer = (i: number): Signer =>
  createWalletClient({ chain, transport: http(net.rpcUrl), account: mnemonicToAccount(MNEMONIC, { addressIndex: i }) });

const ravi = signer(1);
const acme = signer(2);
const relayer = createRelayer({ chain, rpcUrl: net.rpcUrl, relayerKey: net.relayerKey, registry: net.registry, usdt: net.usdt });
const settlement = { chainId: chain.id, registry: net.registry as Address, token: net.usdt as Address };
const day = 86_400;
const now = () => Math.floor(Date.now() / 1000);
let lastPaid = 0n;

function doc(n: string, client: Signer | null, lines: { description: string; qty: number; unitPrice: string }[], extra = {}) {
  return buildInvoice({
    invoiceNumber: n,
    issueDate: "2026-11-06",
    dueDate: "2026-11-20",
    supplier: { legalName: "Ravi Desai", ens: "acme-q4.ravi-dev.eth", wallet: ravi.account.address, nameSalt: "0x" + "ab".repeat(32) },
    customer: { legalName: "Acme Labs Inc.", ens: "acme-labs.eth", wallet: client?.account.address },
    lines,
    settlement,
    ...extra,
  });
}

async function step(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`ok  ${name}`);
}

await step("freelancer: create, link round-trip, pay with wallet, receipt", async () => {
  const d = doc("RD/0001", acme, [
    { description: "Landing page", qty: 1, unitPrice: "400" },
    { description: "Revisions", qty: 2, unitPrice: "50" },
  ]);
  assert.equal(d.total, "500.00");
  const { id } = await hisaab.createInvoice(ravi, {
    client: acme.account.address,
    amount: toUnits(d.total),
    dueDate: BigInt(now() + 14 * day),
    docHash: docHash(d),
    issuerName: "acme-q4.ravi-dev.eth",
    clientName: "acme-labs.eth",
    salt: d.salt,
  });
  const onchain = (await hisaab.getInvoice(id))!;
  assert.equal(onchain.issuerName, "");
  assert.equal(onchain.clientName, "");
  assert.equal(onchain.issuerNode, issuerCommitment("acme-q4.ravi-dev.eth", d.salt));
  const key = generateInvoiceKey(id);
  const link = await payLink("http://localhost:5173", id, d, key);
  const parsed = parseLink(link);
  assert.equal(parsed.id, id);
  assert.equal(keyFromFragment(parsed.fragment), key);
  const back = await decodeFragment(parsed.fragment);
  assert.equal(docHash(back!), onchain.docHash);
  const sealed = await sealInvoice(d, id, key);
  assert.equal(sealed.docHash, onchain.docHash);
  assert.equal(JSON.stringify(sealed).includes("Ravi"), false);
  assert.equal((await openInvoice(sealed, key)).invoiceNumber, "RD/0001");
  await assert.rejects(openInvoice(sealed, generateInvoiceKey(id)));

  const before = await hisaab.usdtBalance(ravi.account.address);
  await hisaab.pay(acme, id, toUnits("200"));
  await hisaab.pay(acme, id, toUnits("300"));
  const inv = (await hisaab.getInvoice(id))!;
  assert.equal(inv.status, "Paid");
  assert.equal((await hisaab.usdtBalance(ravi.account.address)) - before, toUnits("500"));
  assert.equal(await hisaab.receiptOwner(id), RECEIPT_SINK);
  assert.equal((await hisaab.payments(id)).length, 2);
  assert.ok((await hisaab.receiptImage(id))?.startsWith("data:image/svg+xml;base64,"));
  lastPaid = id;
});

await step("receipt QR: matches the reference encoder and decodes to the verify URL", async () => {
  const uri = await pub.readContract({ address: net.receipt, abi: receiptAbi, functionName: "tokenURI", args: [lastPaid] });
  const meta = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  const svg = Buffer.from(meta.image.split(",")[1], "base64").toString();
  if (process.env.SVG_OUT) writeFileSync(process.env.SVG_OUT, svg);
  const d = svg.match(/scale\(4\)"><path[^>]* d="([^"]+)"/)![1];
  const N = 33;
  const grid = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(m[1]) - 4, Number(m[2]) - 4, Number(m[3])];
    for (let i = 0; i < len; i++) grid[y][x + i] = true;
  }
  const ref = QR.create([{ data: meta.external_url, mode: "byte" }], { version: 4, errorCorrectionLevel: "L", maskPattern: 0 });
  assert.equal(ref.modules.size, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) assert.equal(grid[y][x], ref.modules.get(y, x) === 1, `module ${x},${y}`);

  const scale = 4;
  const px = (N + 8) * scale;
  const rgba = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (grid[y][x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const o = (((y + 4) * scale + dy) * px + (x + 4) * scale + dx) * 4;
            rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
          }
  assert.equal(jsQR(rgba, px, px)?.data, `${net.verifyBase ?? "http://localhost:3000/verify/"}${lastPaid}`);
  assert.equal(meta.external_url, `${net.verifyBase ?? "http://localhost:3000/verify/"}${lastPaid}`);
});

await step("gasless: relay pays, rejects replay, stranger and wrong amount", async () => {
  const d = doc("RD/0002", acme, [{ description: "Audit", qty: 1, unitPrice: "120.5" }]);
  const { id } = await hisaab.createInvoice(ravi, {
    client: acme.account.address,
    amount: toUnits(d.total),
    dueDate: BigInt(now() + day),
    docHash: docHash(d),
    issuerName: "acme-q4.ravi-dev.eth",
  });
  const stranger = signer(8);
  const bad = await signGaslessPayment(stranger, { registry: net.registry, usdt: net.usdt, id, amount: toUnits(d.total) });
  assert.equal((await relayer.handle(bad, "t1")).body.ok, false);

  const req = await signGaslessPayment(acme, { registry: net.registry, usdt: net.usdt, id, amount: toUnits(d.total) });
  const tampered = await relayer.handle({ ...req, amount: toUnits("1").toString() }, "t1");
  assert.equal(tampered.body.ok, false);

  const r = await relayer.handle(req, "t1");
  assert.ok(r.body.ok, JSON.stringify(r.body));
  await pub.waitForTransactionReceipt({ hash: (r.body as { txHash: `0x${string}` }).txHash });
  const inv = (await hisaab.getInvoice(id))!;
  assert.equal(inv.status, "Paid");
  assert.equal((await hisaab.payments(id))[0].gasless, true);
  assert.equal((await relayer.handle(req, "t1")).body.ok, false);
});

await step("refund and C15 freeze, then supersede", async () => {
  const d = doc("RD/0003", acme, [{ description: "Work", qty: 5, unitPrice: "100" }]);
  const { id } = await hisaab.createInvoice(ravi, {
    client: acme.account.address,
    amount: toUnits(d.total),
    dueDate: BigInt(now() + day),
    docHash: docHash(d),
    issuerName: "acme-q4.ravi-dev.eth",
  });
  await hisaab.pay(acme, id, toUnits("200"));
  await hisaab.refund(ravi, id, toUnits("100"));
  await assert.rejects(hisaab.pay(acme, id, toUnits("300")));
  await hisaab.refund(ravi, id, toUnits("100"));
  assert.equal((await hisaab.getInvoice(id))!.status, "Refunded");
  const d2 = doc("RD/0003-R", acme, [{ description: "Work", qty: 5, unitPrice: "100" }]);
  const re = await hisaab.createInvoice(ravi, {
    client: acme.account.address,
    amount: toUnits(d2.total),
    dueDate: BigInt(now() + day),
    docHash: docHash(d2),
    issuerName: "acme-q4.ravi-dev.eth",
    supersedes: id,
  });
  assert.equal(await hisaab.supersededBy(id), re.id);
});

await step("contractors: 10 workers bill the company, company pays all with one approval", async () => {
  const company = acme;
  const workers: Signer[] = [];
  for (let i = 0; i < 10; i++) {
    const w = signer(200 + i);
    await pub.request({ method: "anvil_setBalance" as never, params: [w.account.address, `0x${parseEther("1").toString(16)}`] as never });
    workers.push(w);
  }
  const ids: bigint[] = [];
  for (const [i, w] of workers.entries()) {
    const d = buildInvoice({
      invoiceNumber: `C${i}/2026-11`,
      issueDate: "2026-11-30",
      dueDate: "2026-12-07",
      supplier: { legalName: `Worker ${i}`, ens: `w${i}.dev.acme-labs.eth`, wallet: w.account.address },
      customer: { legalName: "Acme Labs Inc.", ens: "acme-labs.eth", wallet: company.account.address },
      lines: [{ description: "Engineering services, Nov 2026", qty: 160, unitPrice: "12.5" }],
      settlement,
      engagement: { kind: "contract-employee", employer: "acme-labs.eth", role: "Software Engineer, contract", periodFrom: "2026-11-01", periodTo: "2026-11-30" },
    });
    const r = await hisaab.createInvoice(w, {
      client: company.account.address,
      amount: toUnits(d.total),
      dueDate: BigInt(now() + 7 * day),
      docHash: docHash(d),
      issuerName: `w${i}.dev.acme-labs.eth`,
      clientName: "acme-labs.eth",
    });
    ids.push(r.id);
  }
  const open = (await hisaab.invoicesByClient(company.account.address)).filter((x) => ids.includes(x.id));
  assert.equal(open.length, 10);
  const total = open.reduce((s, x) => s + x.amount, 0n);
  await hisaab.ensureAllowance(company, total);
  let gas = 0n;
  for (const inv of open) gas += (await hisaab.pay(company, inv.id, inv.amount)).gasUsed;
  for (const id of ids) assert.equal((await hisaab.getInvoice(id))!.status, "Paid");
  console.log(`    paid ${open.length} invoices, total ${formatMoney(total)} USDT, avg pay gas ${gas / BigInt(open.length)}`);
});

console.log("all e2e steps passed");
