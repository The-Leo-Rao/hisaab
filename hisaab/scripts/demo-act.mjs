import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const [action, arg] = process.argv.slice(2)
const demo = JSON.parse(readFileSync(new URL('../../.ens-demo.json', import.meta.url), 'utf8'))
const API = (process.env.API || 'http://localhost:3000').replace(/\/$/, '')
const RPC = process.env.ENS_RPC || demo.rpc
const chain = { ...sepolia, rpcUrls: { default: { http: [RPC] } } }
const pub = createPublicClient({ chain, transport: http(RPC) })

function wallet(who) {
  const k = process.env[`${who.toUpperCase()}_ENS_PK`] || demo.forkKeys?.[who]
  if (!k) throw new Error(`No key for ${who}. Set ${who.toUpperCase()}_ENS_PK.`)
  return createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(k) })
}

async function api(path, body) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json()
  if (!res.ok) throw new Error(`${path}: ${j.error}`)
  return j
}

async function send(who, tx) {
  const w = wallet(who)
  const hash = await w.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value || 0) })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`reverted ${hash}`)
  console.log(`ok  ${tx.action} ${tx.name}  ${hash}`)
}

const acme = demo.ensControllers.acme
const ravi = demo.ensControllers.ravi

if (action === 'revoke') await send('acme', await api('/api/v1/ens/children/revoke', { name: arg, from: acme }))
else if (action === 'approve') await send('acme', await api('/api/v1/hisaab/ens/approve', { name: demo.names.engagement, from: acme, invoiceId: arg }))
else if (action === 'extend') await send('acme', await api('/api/v1/ens/children/modify', { name: arg, from: acme, expiry: String(Math.floor(Date.now() / 1000) + 365 * 86400) }))
else {
  console.log('usage: node hisaab/scripts/demo-act.mjs revoke <name> | approve <invoiceId> | extend <name>')
  console.log(`acme controller ${acme}, ravi controller ${ravi}`)
  process.exit(1)
}
