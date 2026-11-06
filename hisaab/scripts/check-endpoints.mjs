import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPublicClient, encodeFunctionData, http, parseAbi, stringToHex, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'

const API = (process.env.API || 'http://localhost:3000').replace(/\/$/, '')
const RELAY = process.env.RELAY_URL || 'http://localhost:5173/api/relay'
const ID = process.env.INVOICE_ID || '15'
const FRAGMENT = process.env.FRAGMENT || ''
const demo = JSON.parse(readFileSync(new URL('../../.ens-demo.json', import.meta.url), 'utf8'))
const acme = demo.ensControllers.acme
const ravi = demo.ensControllers.ravi
const results = []

async function call(method, path, body, base = API) {
  const res = await fetch(`${base}${path}`, method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, type, data }
}

async function check(name, fn) {
  try {
    await fn()
    results.push(['ok', name])
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`])
  }
}

const isTx = (t) => t.to?.startsWith('0x') && t.data?.startsWith('0x') && t.value === '0x0'

await check('ens GET status', async () => {
  const r = await call('GET', '/api/v1/ens/status')
  assert.equal(r.status, 200)
  assert.equal(r.data.chainId, 11155111)
})
await check('ens GET availability (taken + free)', async () => {
  assert.equal((await call('GET', '/api/v1/ens/availability?name=acme-labs.eth')).data.available, false)
  assert.equal((await call('GET', `/api/v1/ens/availability?name=hisaab-free-${Date.now()}.eth`)).data.available, true)
})
await check('ens GET register/quote', async () => {
  const r = await call('GET', `/api/v1/ens/register/quote?name=hisaabq${Date.now() % 1e6}.eth&owner=${acme}`)
  assert.equal(r.status, 200)
  assert.ok(BigInt(r.data.total) > 0n)
})
await check('ens POST register/prepare-commit (+ value stays 0)', async () => {
  const r = await call('POST', '/api/v1/ens/register/prepare-commit', { name: `hisaabc${Date.now() % 1e6}.eth`, owner: acme, from: acme })
  assert.equal(r.status, 200)
  assert.ok(isTx(r.data) && r.data.secret && r.data.commitment)
})
await check('ens GET register/commitment-status', async () => {
  const r = await call('GET', `/api/v1/ens/register/commitment-status?commitment=0x${'11'.repeat(32)}`)
  assert.equal(r.status, 200)
  assert.equal(r.data.canReveal, false)
})
await check('ens POST register/prepare-reveal (uncommitted -> 409)', async () => {
  const r = await call('POST', '/api/v1/ens/register/prepare-reveal', { name: `hisaabr${Date.now() % 1e6}.eth`, owner: acme, from: acme, secret: `0x${'22'.repeat(32)}` })
  assert.equal(r.status, 409)
})
await check('ens POST auth/challenge + auth/verify', async () => {
  const k = generatePrivateKey()
  const a = privateKeyToAccount(k)
  const c = await call('POST', '/api/v1/ens/auth/challenge', { name: 'acme-labs.eth', address: a.address })
  const sig = await a.signMessage({ message: c.data.message })
  const v = await call('POST', '/api/v1/ens/auth/verify', { challengeId: c.data.challengeId, signature: sig })
  assert.equal(v.status, 200)
  assert.equal(v.data.verified, false)
  if (demo.forkKeys?.acme) {
    const owner = privateKeyToAccount(demo.forkKeys.acme)
    const c2 = await call('POST', '/api/v1/ens/auth/challenge', { name: 'acme-labs.eth', address: owner.address })
    const v2 = await call('POST', '/api/v1/ens/auth/verify', { challengeId: c2.data.challengeId, signature: await owner.signMessage({ message: c2.data.message }) })
    assert.equal(v2.data.verified, true)
  }
})
await check('ens GET children/status', async () => {
  const r = await call('GET', `/api/v1/ens/children/status?parent=dev.acme-labs.eth&from=${acme}`)
  assert.equal(r.status, 200)
  assert.equal(r.data.permissions.create, true)
})
await check('ens POST children/create (prepare)', async () => {
  const r = await call('POST', '/api/v1/ens/children/create', { name: `new${Date.now() % 1e6}.dev.acme-labs.eth`, from: acme })
  assert.equal(r.status, 200)
  assert.ok(isTx(r.data))
  assert.equal(r.data.data.slice(0, 10), '0x85f3e643')
})
await check('ens POST children/create (wrong wallet -> 403)', async () => {
  assert.equal((await call('POST', '/api/v1/ens/children/create', { name: 'x.dev.acme-labs.eth', from: ravi })).status, 403)
})
await check('ens POST children/modify (prepare expiry)', async () => {
  const r = await call('POST', '/api/v1/ens/children/modify', { name: 'arjun.dev.acme-labs.eth', from: acme, expiry: String(Math.floor(Date.now() / 1000) + 400 * 86400) })
  assert.equal(r.status, 200)
  assert.equal(r.data.action, 'extend-child-expiry')
})
await check('ens POST children/revoke (prepare)', async () => {
  const r = await call('POST', '/api/v1/ens/children/revoke', { name: 'arjun.dev.acme-labs.eth', from: acme })
  assert.equal(r.status, 200)
  assert.equal(r.data.action, 'revoke-child')
})
await check('ens POST subchildren/register (prepare)', async () => {
  const r = await call('POST', '/api/v1/ens/subchildren/register', { parent: 'dev.acme-labs.eth', label: `sub${Date.now() % 1e6}`, from: acme })
  assert.equal(r.status, 200)
  assert.ok(isTx(r.data.registration))
})
await check('ens POST subchildren/set-data (tx value is 0)', async () => {
  const r = await call('POST', '/api/v1/ens/subchildren/set-data', { name: 'ravi.dev.acme-labs.eth', from: acme, data: { key: 'hisaab.role', value: 'Senior Engineer, contract' } })
  assert.equal(r.status, 200)
  assert.ok(isTx(r.data))
})
await check('ens unknown route -> 404', async () => {
  assert.equal((await call('GET', '/api/v1/ens/nope')).status, 404)
})

await check('hisaab GET status', async () => {
  const r = await call('GET', '/api/v1/hisaab/status')
  assert.equal(r.data.configured, true)
})
await check('hisaab GET invoice/:id', async () => {
  const r = await call('GET', `/api/v1/hisaab/invoice/${ID}`)
  assert.equal(r.status, 200)
  assert.equal(r.data.invoice.status, 'Paid')
  assert.ok(r.data.payments.length >= 1)
})
await check('hisaab GET invoice/:id unknown -> 404', async () => {
  assert.equal((await call('GET', '/api/v1/hisaab/invoice/999999')).status, 404)
})
await check('hisaab GET receipt/:id (NFT with QR)', async () => {
  const r = await call('GET', `/api/v1/hisaab/receipt/${ID}`)
  assert.equal(r.status, 200)
  const svg = Buffer.from(r.data.image.split(',')[1], 'base64').toString()
  assert.ok(svg.includes('SCAN TO VERIFY') && svg.includes('scale(4)'))
  assert.ok(r.data.external_url.endsWith(`/verify/${ID}`))
})
await check('hisaab GET verify/:id (onchain only)', async () => {
  const r = await call('GET', `/api/v1/hisaab/verify/${ID}`)
  const t = Object.fromEntries(r.data.checks.map((c) => [c.key, c.tone]))
  assert.equal(t.hash, 'grey')
  assert.equal(t.payment, 'green')
})
if (FRAGMENT) {
  await check('hisaab POST verify (fragment) -> verified', async () => {
    const r = await call('POST', '/api/v1/hisaab/verify', { id: ID, fragment: FRAGMENT })
    assert.equal(r.data.verified, true)
  })
  await check('hisaab POST verify (tampered document) -> A red', async () => {
    const doc = (await call('POST', '/api/v1/hisaab/verify', { id: ID, fragment: FRAGMENT })).data.document
    const r = await call('POST', '/api/v1/hisaab/verify', { id: ID, document: { ...doc, total: '5.00' } })
    assert.equal(r.data.checks[0].tone, 'red')
  })
  await check('hisaab POST invoice-pdf -> POST verify (pdf) round-trip', async () => {
    const pdf = await call('POST', '/api/v1/hisaab/invoice-pdf', { id: ID, fragment: FRAGMENT })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.type, 'application/pdf')
    const r = await call('POST', '/api/v1/hisaab/verify', { pdf: pdf.data.toString('base64') })
    assert.equal(r.data.source, 'pdf')
    assert.equal(r.data.verified, true)
  })
  await check('hisaab POST statement (with document)', async () => {
    const r = await call('POST', '/api/v1/hisaab/statement', { id: ID, fragment: FRAGMENT })
    assert.equal(r.type, 'application/pdf')
    assert.equal(r.data.subarray(0, 5).toString(), '%PDF-')
  })
  await check('hisaab POST invoice-pdf wrong id -> 409', async () => {
    assert.equal((await call('POST', '/api/v1/hisaab/invoice-pdf', { id: '1', fragment: FRAGMENT })).status, 409)
  })
}
await check('hisaab GET statement/:id.pdf', async () => {
  const r = await call('GET', `/api/v1/hisaab/statement/${ID}.pdf`)
  assert.equal(r.type, 'application/pdf')
})
await check('hisaab GET qr/:id.svg + .png', async () => {
  assert.ok((await call('GET', `/api/v1/hisaab/qr/${ID}.svg`)).data.toString().startsWith('<svg'))
  const png = await call('GET', `/api/v1/hisaab/qr/${ID}.png?size=240`)
  assert.equal(png.data.subarray(1, 4).toString(), 'PNG')
})
await check('hisaab GET ens/name (contractor records)', async () => {
  const r = await call('GET', '/api/v1/hisaab/ens/name?name=ravi.dev.acme-labs.eth')
  assert.equal(r.data.status, 'registered')
  assert.equal(r.data.records['hisaab.employer'], 'acme-labs.eth')
})
await check('hisaab POST ens/records (subname via teammate set-data)', async () => {
  const r = await call('POST', '/api/v1/hisaab/ens/records', { name: 'arjun.dev.acme-labs.eth', from: acme, kind: 'contractor', issuer: demo.whitechainWallets.arjun, employer: 'acme-labs.eth', role: 'QA Lead, contract' })
  assert.equal(r.status, 200)
  assert.equal(r.data.via, '/api/v1/ens/subchildren/set-data')
  assert.ok(r.data.transactions.every(isTx))
})
await check('hisaab POST ens/records (top-level direct)', async () => {
  const r = await call('POST', '/api/v1/hisaab/ens/records', { name: 'acme-labs.eth', from: acme, records: [{ key: 'hisaab.wallet', value: demo.whitechainWallets.acme }] })
  assert.equal(r.data.via, 'direct setData')
  assert.ok(r.data.transactions.every(isTx))
})
await check('hisaab POST ens/client-role', async () => {
  const r = await call('POST', '/api/v1/hisaab/ens/client-role', { name: 'acme-q4.ravi-dev.eth', from: ravi, client: acme })
  assert.ok(isTx(r.data))
})
await check('hisaab POST ens/approve', async () => {
  const r = await call('POST', '/api/v1/hisaab/ens/approve', { name: 'acme-q4.ravi-dev.eth', from: acme, invoiceId: ID })
  assert.ok(isTx(r.data))
  assert.ok(r.data.recordValue.includes(`invoice:${ID}`))
})
await check('EAC: client may write hisaab.approved but not hisaab.wallet', async () => {
  const pub = createPublicClient({ chain: { ...sepolia, rpcUrls: { default: { http: [demo.rpc] } } }, transport: http(demo.rpc) })
  const abi = parseAbi(['function setData(bytes name, string key, bytes value)'])
  const name = toHex(packetToBytes('acme-q4.ravi-dev.eth'))
  const to = demo.contracts.engagementResolver
  await pub.call({ account: acme, to, data: encodeFunctionData({ abi, functionName: 'setData', args: [name, 'hisaab.approved', stringToHex('invoice:1')] }) })
  await assert.rejects(pub.call({ account: acme, to, data: encodeFunctionData({ abi, functionName: 'setData', args: [name, 'hisaab.wallet', stringToHex(acme)] }) }))
})
await check('page GET /verify/:id', async () => {
  const r = await call('GET', `/verify/${ID}`)
  assert.ok(r.data.toString().includes('Invoice verification'))
})

await check('relay POST /api/relay (bad body -> check 0)', async () => {
  const r = await call('POST', '', { id: 'x' }, RELAY)
  assert.equal(r.status, 400)
  assert.equal(r.data.check, 0)
})
await check('relay POST /api/relay (paid invoice -> check 1)', async () => {
  const r = await call('POST', '', { id: ID, from: demo.whitechainWallets.acme, amount: '1', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), salt: `0x${'33'.repeat(32)}`, signature: `0x${'44'.repeat(65)}` }, RELAY)
  assert.equal(r.data.check, 1)
})

const failed = results.filter(([s]) => s !== 'ok')
for (const [s, n] of results) console.log(`${s.padEnd(4)} ${n}`)
console.log(`\n${results.length - failed.length}/${results.length} endpoint checks passed`)
process.exit(failed.length ? 1 : 0)
