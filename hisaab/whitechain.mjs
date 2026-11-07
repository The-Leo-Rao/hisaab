import { readFileSync } from 'node:fs'
import { createPublicClient, defineChain, http, zeroAddress } from 'viem'
import { config, requireDeployment } from './config.mjs'

const abi = (name) => JSON.parse(readFileSync(new URL(`./abi/${name}.json`, import.meta.url), 'utf8'))
export const registryAbi = abi('HisaabRegistry')
export const receiptAbi = abi('HisaabReceipt')
export const STATUS = ['Open', 'PartiallyPaid', 'Paid', 'Cancelled', 'Refunded']

export const whitechain = defineChain({
  id: config.wcChainId,
  name: config.wcChainId === 1874 ? 'Whitechain Sepolia' : `Chain ${config.wcChainId}`,
  nativeCurrency: { name: 'WBT', symbol: 'WBT', decimals: 18 },
  rpcUrls: { default: { http: [config.wcRpc] } },
})

export const wc = createPublicClient({ chain: whitechain, transport: http(config.wcRpc) })

const LOG_RANGE = BigInt(process.env.WC_LOG_RANGE || 9999)

async function events(eventName, args) {
  const latest = await wc.getBlockNumber()
  const spans = []
  for (let s = config.deployBlock; s <= latest; s += LOG_RANGE + 1n) spans.push([s, s + LOG_RANGE < latest ? s + LOG_RANGE : latest])
  const out = []
  for (let i = 0; i < spans.length; i += 4) {
    const part = await Promise.all(spans.slice(i, i + 4).map(([fromBlock, toBlock]) => wc.getContractEvents({ address: config.registry, abi: registryAbi, eventName, args, fromBlock, toBlock })))
    for (const p of part) out.push(...p)
  }
  return out
}

export function explorerTx(hash) {
  return `${config.explorer}/tx/${hash}`
}

export async function getInvoice(id) {
  requireDeployment()
  const r = await wc.readContract({ address: config.registry, abi: registryAbi, functionName: 'getInvoice', args: [BigInt(id)] })
  if (r.issuer === zeroAddress) return null
  return { id: BigInt(id), ...r, status: STATUS[r.status] }
}

export async function payments(id) {
  const logs = await events('Paid', { id: BigInt(id) })
  return logs.map((l) => ({
    payer: l.args.payer,
    amount: l.args.amount,
    totalPaid: l.args.totalPaid,
    gasless: l.args.gasless,
    txHash: l.transactionHash,
    blockNumber: l.blockNumber,
    explorer: explorerTx(l.transactionHash),
  }))
}

export async function refunds(id) {
  const logs = await events('Refunded', { id: BigInt(id) })
  return logs.map((l) => ({ to: l.args.to, amount: l.args.amount, txHash: l.transactionHash, explorer: explorerTx(l.transactionHash) }))
}

export async function receipt(id) {
  requireDeployment()
  try {
    const [owner, uri] = await Promise.all([
      wc.readContract({ address: config.receipt, abi: receiptAbi, functionName: 'ownerOf', args: [BigInt(id)] }),
      wc.readContract({ address: config.receipt, abi: receiptAbi, functionName: 'tokenURI', args: [BigInt(id)] }),
    ])
    const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'))
    return { exists: true, owner, tokenId: BigInt(id), contract: config.receipt, ...meta }
  } catch {
    return { exists: false, owner: null, tokenId: BigInt(id), contract: config.receipt }
  }
}
