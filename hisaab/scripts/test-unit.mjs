import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { canonical, decodeFragmentDoc, docHash, isoDate, longDate, money } from '../invoice.mjs'
import { qrPng, qrSvg } from '../qr.mjs'
import { extractAttachments, invoicePdf, statementPdf } from '../pdf.mjs'

const results = []

async function check(name, fn) {
  try {
    await fn()
    results.push(['ok', name])
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`])
  }
}

function encodeFragmentDoc(doc) {
  const json = canonical(doc)
  const compressed = gzipSync(Buffer.from(json, 'utf8'))
  const b64 = compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#d=${b64}`
}

await check('invoice canonicalization is deterministic', async () => {
  const doc = { b: 2, a: 1, c: { z: 9, y: 8 } }
  const first = canonical(doc)
  const second = canonical({ c: { y: 8, z: 9 }, a: 1, b: 2 })
  assert.equal(first, second)
  assert.ok(first.includes('"a":1'))
})

await check('docHash is keccak256 of canonical JSON', async () => {
  const doc = { invoiceNumber: 'INV-1', total: '100.00' }
  const h1 = docHash(doc)
  const h2 = docHash({ total: '100.00', invoiceNumber: 'INV-1' })
  assert.equal(h1, h2)
  assert.ok(h1.startsWith('0x'))
})

await check('money formatting', async () => {
  assert.equal(money(1000000n), '1.00')
  assert.equal(money(1234567n), '1.234567')
  assert.equal(money(50n), '0.00005')
})

await check('date formatting', async () => {
  assert.equal(isoDate(1704067200n), '2024-01-01')
  assert.equal(longDate(1704067200n), '1 Jan 2024')
  assert.equal(isoDate(0n), null)
})

await check('fragment document round-trip', async () => {
  const doc = { invoiceNumber: 'INV-RT', total: '50.00' }
  const fragment = encodeFragmentDoc(doc)
  const decoded = await decodeFragmentDoc(fragment)
  assert.deepEqual(decoded, doc)
})

await check('qr code generation', async () => {
  const svg = await qrSvg('https://example.com/verify/1')
  assert.ok(svg.startsWith('<svg'))
  const png = await qrPng('https://example.com/verify/1', 120)
  assert.equal(Buffer.from(png.subarray(1, 4)).toString(), 'PNG')
})

await check('pdf attachment extraction', async () => {
  const doc = {
    invoiceNumber: 'INV-PDF',
    issueDate: '2024-01-01',
    dueDate: '2024-02-01',
    supplier: { legalName: 'Acme', ens: 'acme.eth', wallet: '0x0000000000000000000000000000000000000001' },
    customer: { legalName: 'Bob', ens: 'bob.eth', wallet: '0x0000000000000000000000000000000000000002' },
    engagement: { kind: 'freelance' },
    lines: [{ description: 'Work', qty: 1, unitPrice: '100.00', amount: '100.00' }],
    total: '100.00',
    currency: 'USDT',
    settlement: { chainId: 1874, amountUnits: '1000000', registry: '0x0000000000000000000000000000000000000003' },
  }
  const inv = { docHash: docHash(doc), status: 'Open', amount: 1000000n, paid: 0n, refunded: 0n, createdAt: 1704067200n, dueDate: 1706745600n, paidAt: 0n }
  const pdf = await invoicePdf(1, doc, inv)
  assert.ok(pdf.length > 0)
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), '%PDF-')
  const files = await extractAttachments(Buffer.from(pdf))
  assert.ok(files['hisaab-meta.json'])
  assert.ok(files['invoice.json'])
  const extracted = JSON.parse(files['invoice.json'])
  assert.equal(extracted.invoiceNumber, 'INV-PDF')
})

await check('statement pdf generation', async () => {
  const result = {
    id: '1',
    exists: true,
    verified: true,
    kind: 'freelance',
    summary: 'Verified.',
    checks: [
      { key: 'hash', label: 'A · Document', tone: 'green', text: 'Match.' },
      { key: 'issuer', label: 'B · Issuer', tone: 'green', text: 'OK.' },
      { key: 'standing', label: 'C · Standing', tone: 'green', text: 'OK.' },
      { key: 'payment', label: 'D · Payment', tone: 'green', text: 'Paid.' },
      { key: 'client', label: 'Client', tone: 'grey', text: 'N/A.' },
    ],
    invoice: {
      status: 'Paid',
      amount: 1000000n,
      paid: 1000000n,
      refunded: 0n,
      createdAt: 1704067200n,
      dueDate: 1706745600n,
      paidAt: 1704153600n,
      amountText: '1.00',
      paidText: '1.00',
      refundedText: '0.00',
      issuer: '0x0000000000000000000000000000000000000001',
      issuerName: 'acme.eth',
      clientName: 'bob.eth',
      docHash: '0x' + '11'.repeat(32),
    },
    payments: [{ payer: '0x0000000000000000000000000000000000000002', amount: 1000000n, totalPaid: 1000000n, gasless: false, txHash: '0x' + '22'.repeat(32), blockNumber: 100n, explorer: 'https://example.com/tx/0x22' }],
    refunds: [],
    receipt: { exists: true, owner: '0x0000000000000000000000000000000000000001', tokenId: '1', contract: '0x0000000000000000000000000000000000000003', image: null, external_url: null },
    ens: { issuer: { status: 'registered', wallet: '0x0000000000000000000000000000000000000001', records: {} }, client: null },
    chain: { chainId: 1874, registry: '0x0000000000000000000000000000000000000003', receipt: '0x0000000000000000000000000000000000000004', usdt: '0x0000000000000000000000000000000000000005', explorer: 'https://example.com' },
    checkedAt: new Date().toISOString(),
  }
  const pdf = await statementPdf(result, null)
  assert.ok(pdf.length > 0)
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), '%PDF-')
})

const failed = results.filter(([s]) => s !== 'ok')
for (const [s, n] of results) console.log(`${s.padEnd(4)} ${n}`)
console.log(`\n${results.length - failed.length}/${results.length} unit tests passed`)
process.exit(failed.length ? 1 : 0)
