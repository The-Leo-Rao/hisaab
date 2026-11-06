import {
  maxUint256,
  parseAbi,
  parseEventLogs,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { receiptAbi, registryAbi } from "./abi";
import { ensNode, issuerCommitment } from "./commit";

export const usdtAbi = parseAbi([
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function mint(address to, uint256 amount)",
]);

export const RECEIPT_SINK: Address = "0x000000000000000000000000000000000000dEaD";

export const STATUS = ["Open", "PartiallyPaid", "Paid", "Cancelled", "Refunded"] as const;
export type StatusName = (typeof STATUS)[number];

export type HisaabAddresses = { registry: Address; receipt: Address; usdt: Address; deployBlock: bigint };
export type Signer = WalletClient<Transport, Chain, Account>;

export type OnchainInvoice = {
  id: bigint;
  issuer: Address;
  client: Address;
  payer: Address;
  amount: bigint;
  paid: bigint;
  refunded: bigint;
  createdAt: bigint;
  dueDate: bigint;
  paidAt: bigint;
  status: StatusName;
  docHash: Hex;
  issuerNode: Hex;
  supersedes: bigint;
  issuerName: string;
  clientName: string;
};

export type CreateInput = {
  client?: Address;
  amount: bigint;
  dueDate: bigint;
  docHash: Hex;
  issuerName: string;
  clientName?: string;
  supersedes?: bigint;
  salt?: Hex;
};

export type PaymentEvent = {
  payer: Address;
  amount: bigint;
  totalPaid: bigint;
  gasless: boolean;
  txHash: Hex;
  blockNumber: bigint;
};

export function remaining(inv: OnchainInvoice): bigint {
  return inv.amount - inv.paid;
}

export function isPayable(inv: OnchainInvoice): boolean {
  return inv.refunded === 0n && (inv.status === "Open" || inv.status === "PartiallyPaid");
}

export function createHisaab(client: PublicClient, addrs: HisaabAddresses) {
  const reg = { address: addrs.registry, abi: registryAbi } as const;

  async function getInvoice(id: bigint): Promise<OnchainInvoice | null> {
    const r = await client.readContract({ ...reg, functionName: "getInvoice", args: [id] });
    if (r.issuer === zeroAddress) return null;
    return {
      id,
      issuer: r.issuer,
      client: r.client,
      payer: r.payer,
      amount: r.amount,
      paid: r.paid,
      refunded: r.refunded,
      createdAt: r.createdAt,
      dueDate: r.dueDate,
      paidAt: r.paidAt,
      status: STATUS[r.status],
      docHash: r.docHash,
      issuerNode: r.issuerNode,
      supersedes: r.supersedes,
      issuerName: r.issuerName,
      clientName: r.clientName,
    };
  }

  async function createdIds(filter: { issuer?: Address; client?: Address }): Promise<bigint[]> {
    const logs = await client.getContractEvents({
      ...reg,
      eventName: "InvoiceCreated",
      args: filter,
      fromBlock: addrs.deployBlock,
      toBlock: "latest",
    });
    return [...new Set(logs.map((l) => l.args.id!))];
  }

  async function many(ids: bigint[]): Promise<OnchainInvoice[]> {
    const all = await Promise.all(ids.map(getInvoice));
    return all.filter((x): x is OnchainInvoice => x !== null);
  }

  async function payments(id: bigint): Promise<PaymentEvent[]> {
    const logs = await client.getContractEvents({
      ...reg,
      eventName: "Paid",
      args: { id },
      fromBlock: addrs.deployBlock,
      toBlock: "latest",
    });
    return logs.map((l) => ({
      payer: l.args.payer!,
      amount: l.args.amount!,
      totalPaid: l.args.totalPaid!,
      gasless: l.args.gasless!,
      txHash: l.transactionHash,
      blockNumber: l.blockNumber,
    }));
  }

  async function receiptOwner(id: bigint): Promise<Address | null> {
    try {
      return await client.readContract({ address: addrs.receipt, abi: receiptAbi, functionName: "ownerOf", args: [id] });
    } catch {
      return null;
    }
  }

  async function receiptImage(id: bigint): Promise<string | null> {
    try {
      const uri = await client.readContract({ address: addrs.receipt, abi: receiptAbi, functionName: "tokenURI", args: [id] });
      const json = JSON.parse(atob(uri.replace("data:application/json;base64,", "")));
      return json.image as string;
    } catch {
      return null;
    }
  }

  const usdtBalance = (who: Address) =>
    client.readContract({ address: addrs.usdt, abi: usdtAbi, functionName: "balanceOf", args: [who] });

  async function confirm(hash: Hex) {
    const rcpt = await client.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
    return rcpt;
  }

  async function ensureAllowance(wallet: Signer, amount: bigint, opts: { unlimited?: boolean } = {}) {
    const owner = wallet.account.address;
    const current = await client.readContract({
      address: addrs.usdt,
      abi: usdtAbi,
      functionName: "allowance",
      args: [owner, addrs.registry],
    });
    if (current >= amount) return null;
    const hash = await wallet.writeContract({
      address: addrs.usdt,
      abi: usdtAbi,
      functionName: "approve",
      args: [addrs.registry, opts.unlimited ? maxUint256 : amount],
      account: wallet.account,
      chain: wallet.chain,
    });
    return confirm(hash);
  }

  async function createInvoice(wallet: Signer, p: CreateInput) {
    const hash = await wallet.writeContract({
      ...reg,
      functionName: "createInvoice",
      args: [
        {
          client: p.client ?? zeroAddress,
          amount: p.amount,
          dueDate: p.dueDate,
          docHash: p.docHash,
          issuerNode: p.salt ? issuerCommitment(p.issuerName, p.salt) : ensNode(p.issuerName),
          issuerName: p.salt ? "" : p.issuerName,
          clientName: p.salt ? "" : p.clientName ?? "",
          supersedes: p.supersedes ?? 0n,
        },
      ],
      account: wallet.account,
      chain: wallet.chain,
    });
    const rcpt = await confirm(hash);
    const [ev] = parseEventLogs({ abi: registryAbi, eventName: "InvoiceCreated", logs: rcpt.logs });
    return { id: ev.args.id, txHash: hash, gasUsed: rcpt.gasUsed };
  }

  async function pay(wallet: Signer, id: bigint, amount: bigint) {
    await ensureAllowance(wallet, amount);
    const hash = await wallet.writeContract({
      ...reg,
      functionName: "pay",
      args: [id, amount],
      account: wallet.account,
      chain: wallet.chain,
    });
    const rcpt = await confirm(hash);
    return { txHash: hash, gasUsed: rcpt.gasUsed };
  }

  async function refund(wallet: Signer, id: bigint, amount: bigint) {
    await ensureAllowance(wallet, amount);
    const hash = await wallet.writeContract({
      ...reg,
      functionName: "refund",
      args: [id, amount],
      account: wallet.account,
      chain: wallet.chain,
    });
    await confirm(hash);
    return { txHash: hash };
  }

  async function cancel(wallet: Signer, id: bigint) {
    const hash = await wallet.writeContract({
      ...reg,
      functionName: "cancel",
      args: [id],
      account: wallet.account,
      chain: wallet.chain,
    });
    await confirm(hash);
    return { txHash: hash };
  }

  return {
    addresses: addrs,
    client,
    getInvoice,
    many,
    invoicesByIssuer: async (issuer: Address) => many(await createdIds({ issuer })),
    invoicesByClient: async (c: Address) => many(await createdIds({ client: c })),
    isOverdue: (id: bigint) => client.readContract({ ...reg, functionName: "isOverdue", args: [id] }),
    nextId: () => client.readContract({ ...reg, functionName: "nextId" }),
    supersededBy: (id: bigint) => client.readContract({ ...reg, functionName: "supersededBy", args: [id] }),
    payments,
    receiptOwner,
    receiptImage,
    usdtBalance,
    ensureAllowance,
    createInvoice,
    pay,
    refund,
    cancel,
  };
}

export type Hisaab = ReturnType<typeof createHisaab>;
