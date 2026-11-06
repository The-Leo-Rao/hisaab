import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const API = (process.env.API || 'http://localhost:3000').replace(/\/$/, '')
const ID = process.env.INVOICE_ID || '15'
const FRAGMENT = process.env.FRAGMENT || ''
const DEMO_FILE = new URL('../../.ens-demo.json', import.meta.url)
const hasDemo = existsSync(DEMO_FILE)
const demo = hasDemo ? JSON.parse(readFileSync(DEMO_FILE, 'utf8')) : {}
const acme = demo.ensControllers?.acme
const ravi = demo.ensControllers?.ravi
const results = []

async function call(method, path, body, base = API) {
  const init = method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }
  const res = await fetch(`${base}${path}`, init)
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

// ---------------------------------------------------------------------------
// Base ENS endpoint coverage
// ---------------------------------------------------------------------------

await check('ens GET status', async () => {
  const r = await call('GET', '/api/v1/ens/status')
  assert.equal(r.status, 200)
  assert.equal(r.data.chainId, 11155111)
})

await check('ens GET availability', async () => {
  assert.equal((await call('GET', `/api/v1/ens/availability?name=hisaab-free-${Date.now()}.eth`)).data.available, true)
  if (hasDemo) {
    assert.equal((await call('GET', '/api/v1/ens/availability?name=acme-labs.eth')).data.available, false)
  }
})

await check('ens GET register/quote', async () => {
  const r = await call('GET', `/api/v1/ens/register/quote?name=hisaabq${Date.now() % 1e6}.eth&owner=${acme || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'}`)
  assert.equal(r.status, 200)
  assert.ok(BigInt(r.data.total) > 0n)
})

await check('ens POST register/prepare-commit', async () => {
  const r = await call('POST', '/api/v1/ens/register/prepare-commit', { name: `hisaabc${Date.now() % 1e6}.eth`, owner: acme || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', from: acme || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' })
  assert.equal(r.status, 200)
  assert.ok(isTx(r.data) && r.data.secret && r.data.commitment)
})

await check('ens GET register/commitment-status', async () => {
  const r = await call('GET', `/api/v1/ens/register/commitment-status?commitment=0x${'11'.repeat(32)}`)
  assert.equal(r.status, 200)
  assert.equal(r.data.canReveal, false)
})

await check('ens POST register/prepare-reveal (uncommitted -> 409)', async () => {
  const r = await call('POST', '/api/v1/ens/register/prepare-reveal', { name: `hisaabr${Date.now() % 1e6}.eth`, owner: acme || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', from: acme || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', secret: `0x${'22'.repeat(32)}` })
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

if (acme) {
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

  await check('ens POST subchildren/set-data (canonical shape)', async () => {
    const r = await call('POST', '/api/v1/ens/subchildren/set-data', { name: 'ravi.dev.acme-labs.eth', from: acme, data: { key: 'hisaab.role', value: 'Senior Engineer, contract' } })
    assert.equal(r.status, 200)
    assert.ok(isTx(r.data))
    assert.equal(r.data.encodedValue, '0x53656e696f7220456e67696e6565722c20636f6e7472616374')
    assert.equal(r.data.metadata.encodedValue, '0x53656e696f7220456e67696e6565722c20636f6e7472616374')
    assert.equal(r.data.metadata.value, '0x53656e696f7220456e67696e6565722c20636f6e7472616374')
    // Top-level value must remain the transaction value, not the stored data value.
    assert.equal(r.data.value, '0x0')
  })
}

await check('ens unknown route -> 404', async () => {
  assert.equal((await call('GET', '/api/v1/ens/nope')).status, 404)
})

// ---------------------------------------------------------------------------
// Legacy compatibility routes (base-style frontend)
// ---------------------------------------------------------------------------

if (acme) {
  await check('legacy POST /api/v1/ens/subchildren/update-data alias', async () => {
    const r = await call('POST', '/api/v1/ens/subchildren/update-data', { name: 'ravi.dev.acme-labs.eth', from: acme, data: { key: 'legacy.test', value: 'legacy-value', encoding: 'utf8' } })
    assert.equal(r.status, 200)
    assert.equal(r.data.action, 'set-subchild-data')
    assert.equal(r.data.value, '0x0')
    assert.equal(r.data.metadata.value, '0x6c65676163792d76616c7565')
  })

  await check('legacy POST /api/v1/ens/subchildren/unregister alias', async () => {
    const r = await call('POST', '/api/v1/ens/subchildren/unregister', { name: 'arjun.dev.acme-labs.eth', from: acme })
    assert.equal(r.status, 200)
    assert.equal(r.data.action, 'revoke-child')
  })

  await check('legacy GET /api/v1/ens/subregistries event history', async () => {
    const r = await call('GET', `/api/v1/ens/subregistries?parent=dev.acme-labs.eth`)
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.data.subregistries))
    assert.ok(Array.isArray(r.data.history))
    assert.equal(r.data.parent, 'dev.acme-labs.eth')
  })
}

// ---------------------------------------------------------------------------
// Advanced Hisaab endpoint coverage
// ---------------------------------------------------------------------------

await check('hisaab GET status', async () => {
  const r = await call('GET', '/api/v1/hisaab/status')
  assert.equal(typeof r.data.configured, 'boolean')
})

if (hasDemo) {
  await check('hisaab GET invoice/:id', async () => {
    const r = await call('GET', `/api/v1/hisaab/invoice/${ID}`)
    assert.equal(r.status, 200)
    assert.equal(r.data.invoice.status, 'Paid')
    assert.ok(r.data.payments.length >= 1)
  })

  await check('hisaab GET invoice/:id unknown -> 404', async () => {
    assert.equal((await call('GET', '/api/v1/hisaab/invoice/999999')).status, 404)
  })

  await check('hisaab GET receipt/:id', async () => {
    const r = await call('GET', `/api/v1/hisaab/receipt/${ID}`)
    assert.equal(r.status, 200)
    assert.ok(r.data.exists)
  })

  await check('hisaab GET verify/:id', async () => {
    const r = await call('GET', `/api/v1/hisaab/verify/${ID}`)
    assert.equal(r.status, 200)
    const t = Object.fromEntries(r.data.checks.map((c) => [c.key, c.tone]))
    assert.equal(t.hash, 'grey')
    assert.equal(t.payment, 'green')
  })

  await check('hisaab GET qr/:id.svg + .png', async () => {
    assert.ok((await call('GET', `/api/v1/hisaab/qr/${ID}.svg`)).data.toString().startsWith('<svg'))
    const png = await call('GET', `/api/v1/hisaab/qr/${ID}.png?size=240`)
    assert.equal(png.data.subarray(1, 4).toString(), 'PNG')
  })

  await check('hisaab GET statement/:id.pdf', async () => {
    const r = await call('GET', `/api/v1/hisaab/statement/${ID}.pdf`)
    assert.equal(r.type, 'application/pdf')
    assert.equal(r.data.subarray(0, 5).toString(), '%PDF-')
  })

  await check('hisaab GET ens/name', async () => {
    const r = await call('GET', '/api/v1/hisaab/ens/name?name=ravi.dev.acme-labs.eth')
    assert.equal(r.status, 200)
    assert.equal(r.data.status, 'registered')
    assert.equal(r.data.records['hisaab.employer'], 'acme-labs.eth')
  })
}

if (FRAGMENT && hasDemo) {
  await check('advanced frontend: Hisaab verification with fragment', async () => {
    const r = await call('POST', '/api/v1/hisaab/verify', { id: ID, fragment: FRAGMENT })
    assert.equal(r.status, 200)
    assert.equal(r.data.verified, true)
  })

  await check('advanced frontend: sealed invoice PDF generation', async () => {
    const { generateInvoiceKey, sealInvoice } = await import('../seal.mjs')
    const doc = (await call('POST', '/api/v1/hisaab/verify', { id: ID, fragment: FRAGMENT })).data.document
    const r = await call('POST', '/api/v1/hisaab/invoice-pdf', { id: ID, sealed: await sealInvoice(doc, ID, generateInvoiceKey(ID)) })
    assert.equal(r.status, 200)
    assert.equal(r.type, 'application/pdf')
    assert.equal(r.data.subarray(0, 5).toString(), '%PDF-')
  })

  await check('advanced frontend: statement PDF generation with document', async () => {
    const r = await call('POST', '/api/v1/hisaab/statement', { id: ID, fragment: FRAGMENT })
    assert.equal(r.type, 'application/pdf')
    assert.equal(r.data.subarray(0, 5).toString(), '%PDF-')
  })
}

if (acme && hasDemo) {
  await check('advanced frontend: ENS record setup for Hisaab', async () => {
    const r = await call('POST', '/api/v1/hisaab/ens/records', { name: 'arjun.dev.acme-labs.eth', from: acme, kind: 'contractor', walletCommitment: `0x${'5a'.repeat(32)}`, employer: 'acme-labs.eth', role: 'QA Lead, contract' })
    assert.equal(r.status, 200)
    assert.equal(r.data.via, '/api/v1/ens/subchildren/set-data')
    assert.ok(r.data.transactions.every(isTx))
    // Each transaction is produced by the internal teammate set-data call.
    for (const tx of r.data.transactions) {
      assert.equal(tx.value, '0x0')
      assert.ok(tx.metadata.encodedValue)
      assert.ok(tx.metadata.value)
    }
  })

  await check('hisaab internal call to /api/v1/ens/subchildren/set-data', async () => {
    // The previous test exercises this indirectly; this is an explicit probe.
    const r = await call('POST', '/api/v1/hisaab/ens/records', { name: 'priya.dev.acme-labs.eth', from: acme, kind: 'contractor', walletCommitment: `0x${'6b'.repeat(32)}`, employer: 'acme-labs.eth', role: 'Designer, contract' })
    assert.equal(r.status, 200)
    assert.equal(r.data.via, '/api/v1/ens/subchildren/set-data')
    assert.ok(r.data.transactions.length >= 2)
    for (const tx of r.data.transactions) {
      assert.equal(tx.action, 'set-subchild-data')
      assert.equal(tx.value, '0x0')
    }
  })

  await check('hisaab POST ens/client-role', async () => {
    const r = await call('POST', '/api/v1/hisaab/ens/client-role', { name: 'acme-q4.ravi-dev.eth', from: ravi, client: acme })
    assert.ok(isTx(r.data))
  })

  await check('hisaab POST ens/approve', async () => {
    const approval = `0x${'7b'.repeat(32)}`
    const r = await call('POST', '/api/v1/hisaab/ens/approve', { name: 'acme-q4.ravi-dev.eth', from: acme, approval })
    assert.ok(isTx(r.data))
    assert.ok(r.data.recordValue.includes(approval))
  })
}

await check('page GET /verify/:id', async () => {
  const r = await call('GET', `/verify/${ID}`)
  assert.ok(r.data.toString().includes('Invoice verification'))
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const failed = results.filter(([s]) => s !== 'ok')
for (const [s, n] of results) console.log(`${s.padEnd(4)} ${n}`)
console.log(`\n${results.length - failed.length}/${results.length} tests passed`)
if (!hasDemo) {
  console.log('\nNote: .ens-demo.json not found; integration tests that require demo state were skipped.')
}
process.exit(failed.length ? 1 : 0)
