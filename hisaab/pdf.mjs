import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, rgb, StandardFonts } from 'pdf-lib'
import { config, verifyUrl } from './config.mjs'
import { longDate, money } from './invoice.mjs'
import { qrPng } from './qr.mjs'

const W = 595.28
const H = 841.89
const M = 48
const C = {
  ink: rgb(0.06, 0.09, 0.16),
  muted: rgb(0.39, 0.45, 0.55),
  line: rgb(0.88, 0.9, 0.93),
  band: rgb(0.043, 0.071, 0.125),
  white: rgb(1, 1, 1),
  green: rgb(0.06, 0.6, 0.4),
  amber: rgb(0.85, 0.55, 0.05),
  red: rgb(0.86, 0.2, 0.2),
  grey: rgb(0.55, 0.6, 0.66),
}
const TONE = { green: C.green, amber: C.amber, red: C.red, grey: C.grey }

const safe = (s) => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…€]/g, '?')
const short = (h, n = 10) => (h && h.length > 2 * n ? `${h.slice(0, n)}...${h.slice(-6)}` : h || '-')

class Page {
  constructor(doc, fonts) {
    this.doc = doc
    this.f = fonts
    this.page = doc.addPage([W, H])
    this.y = H - M
  }

  text(t, x, y, { size = 10, font = this.f.regular, color = C.ink } = {}) {
    this.page.drawText(safe(t), { x, y, size, font, color })
  }

  wrap(t, x, width, { size = 10, font = this.f.regular, color = C.ink, gap = 3 } = {}) {
    const words = safe(t).split(/\s+/)
    let line = ''
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(next, size) > width && line) {
        this.ensure(size + gap)
        this.text(line, x, this.y, { size, font, color })
        this.y -= size + gap
        line = w
      } else line = next
    }
    if (line) {
      this.ensure(size + gap)
      this.text(line, x, this.y, { size, font, color })
      this.y -= size + gap
    }
  }

  ensure(h) {
    if (this.y - h < M + 30) {
      this.page = this.doc.addPage([W, H])
      this.y = H - M
    }
  }

  rule() {
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.6, color: C.line })
    this.y -= 14
  }

  heading(t) {
    this.ensure(90)
    this.y -= 8
    this.text(t.toUpperCase(), M, this.y, { size: 9, font: this.f.bold, color: C.muted })
    this.y -= 8
    this.rule()
  }

  kv(pairs, cols = 2) {
    const colW = (W - 2 * M) / cols
    for (let i = 0; i < pairs.length; i += cols) {
      this.ensure(30)
      pairs.slice(i, i + cols).forEach(([k, v], j) => {
        this.text(k, M + j * colW, this.y, { size: 8, color: C.muted })
        this.text(v ?? '-', M + j * colW, this.y - 12, { size: 10.5, font: this.f.bold })
      })
      this.y -= 30
    }
  }
}

async function base(title) {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setProducer('Hisaab')
  doc.setCreator('Hisaab')
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  }
  return { doc, fonts }
}

async function band(p, title, subtitle, id) {
  p.page.drawRectangle({ x: 0, y: H - 150, width: W, height: 150, color: C.band })
  p.text('HISAAB', M, H - 62, { size: 20, font: p.f.bold, color: C.white })
  p.text(title, M, H - 90, { size: 13, font: p.f.bold, color: rgb(0.2, 0.83, 0.6) })
  p.text(subtitle, M, H - 108, { size: 9.5, color: rgb(0.8, 0.84, 0.9) })
  const png = await p.doc.embedPng(await qrPng(verifyUrl(id), 300))
  p.page.drawRectangle({ x: W - M - 104, y: H - 136, width: 104, height: 104, color: C.white })
  p.page.drawImage(png, { x: W - M - 102, y: H - 134, width: 100, height: 100 })
  p.text('Scan to verify', W - M - 104, H - 146, { size: 7.5, color: rgb(0.8, 0.84, 0.9) })
  p.y = H - 178
}

async function attachAll(doc, id, sealed) {
  const meta = { chainId: config.wcChainId, registry: config.registry, id: Number(id) }
  await doc.attach(new TextEncoder().encode(JSON.stringify(meta)), 'hisaab-meta.json', { mimeType: 'application/json', description: 'Which invoice to look up' })
  if (sealed) {
    await doc.attach(new TextEncoder().encode(JSON.stringify(sealed)), 'invoice.enc', { mimeType: 'application/json', description: 'Invoice details, AES-256-GCM. Open with the invoice key.' })
  }
}

function lineTable(p, doc) {
  const cols = [M, M + 290, M + 340, M + 420]
  p.ensure(30)
  ;['Description', 'Qty', 'Unit (USDT)', 'Amount (USDT)'].forEach((h, i) => p.text(h, cols[i], p.y, { size: 8, font: p.f.bold, color: C.muted }))
  p.y -= 6
  p.rule()
  for (const l of doc.lines || []) {
    p.ensure(18)
    p.text(String(l.description).slice(0, 52), cols[0], p.y, { size: 10 })
    p.text(String(l.qty), cols[1], p.y, { size: 10 })
    p.text(String(l.unitPrice), cols[2], p.y, { size: 10 })
    p.text(String(l.amount), cols[3], p.y, { size: 10 })
    p.y -= 16
  }
  p.y -= 4
  p.rule()
  p.text('Total', cols[2], p.y, { size: 11, font: p.f.bold })
  p.text(`${doc.total} ${doc.currency || 'USDT'}`, cols[3], p.y, { size: 11, font: p.f.bold })
  p.y -= 22
}

export async function statementPdf(result, document) {
  const { doc, fonts } = await base(`Hisaab Statement - Invoice #${result.id}`)
  const p = new Page(doc, fonts)
  const inv = result.invoice
  await band(p, 'Statement of payment', `Invoice #${result.id} on ${result.chain.chainId === 1874 ? 'Whitechain Sepolia' : `chain ${result.chain.chainId}`}`, result.id)

  const tone = Object.fromEntries(result.checks.map((c) => [c.key, c.tone]))
  const locked = result.sealed && !result.unlocked
  const onchainOnly = !result.verified && tone.hash === 'grey' && tone.issuer === 'green' && tone.payment === 'green'
  const verdictColor = result.verified ? C.green : locked ? (tone.payment === 'green' ? C.green : C.grey) : onchainOnly ? C.green : result.checks.some((c) => c.tone === 'red') ? C.red : C.amber
  const title = result.verified ? 'VERIFIED' : locked ? 'SEALED · PUBLIC FACTS ONLY' : onchainOnly ? 'VERIFIED ONCHAIN · DOCUMENT NOT ATTACHED' : 'NOT FULLY VERIFIED'
  const note = result.summary || (locked
    ? 'Who this invoice is between is sealed. The payment facts below are public onchain. Drop the invoice PDF on the verify page with its invoice key to check the parties.'
    : onchainOnly
    ? 'Issuer and payment check out onchain. Attach the invoice (or drop its PDF on the verify page) to also prove the document itself.'
    : 'One or more checks below are not green. Read each row before relying on this invoice.')
  const lines = []
  let cur = ''
  for (const w of note.split(/\s+/)) {
    const next = cur ? cur + ' ' + w : w
    if (fonts.regular.widthOfTextAtSize(next, 8.5) > W - 2 * M - 24 && cur) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  const boxH = 30 + lines.length * 11
  p.page.drawRectangle({ x: M, y: p.y - boxH + 8, width: W - 2 * M, height: boxH, color: verdictColor, opacity: 0.1, borderColor: verdictColor, borderWidth: 1 })
  p.text(title, M + 12, p.y - 10, { size: 11, font: fonts.bold, color: verdictColor })
  lines.forEach((l, i) => p.text(l, M + 12, p.y - 26 - i * 11, { size: 8.5, color: C.ink }))
  p.y -= boxH + 16

  p.heading('Invoice')
  p.kv([
    ['Invoice number', document?.invoiceNumber ?? '(document not supplied)'],
    ['Amount', `${inv.amountText} USDT`],
    ['Issued by (ENS)', inv.issuerName || document?.supplier?.ens || (result.sealed ? 'Sealed' : '-')],
    ['Billed to (ENS)', inv.clientName || document?.customer?.ens || (result.sealed ? 'Sealed' : '-')],
    ['Supplier', document?.supplier?.legalName ?? '-'],
    ['Customer', document?.customer?.legalName ?? '-'],
    ['Created onchain', longDate(inv.createdAt)],
    ['Paid onchain', longDate(inv.paidAt) ?? 'not paid'],
  ])
  if (document?.engagement?.kind === 'contract-employee') {
    p.kv([
      ['Engagement', `Contractor at ${document.engagement.employer || '-'}`],
      ['Role / period', `${document.engagement.role || '-'} (${document.engagement.periodFrom || '?'} to ${document.engagement.periodTo || '?'})`],
    ])
  }
  if (document?.lines?.length) {
    p.heading('Line items')
    lineTable(p, document)
  }

  p.heading('Checks')
  for (const c of result.checks) {
    p.ensure(36)
    p.page.drawCircle({ x: M + 4, y: p.y + 3, size: 4, color: TONE[c.tone] })
    p.text(c.label, M + 14, p.y, { size: 10, font: fonts.bold })
    p.text(c.tone.toUpperCase(), W - M - 40, p.y, { size: 8, font: fonts.bold, color: TONE[c.tone] })
    p.y -= 14
    p.wrap(c.text, M + 14, W - 2 * M - 14, { size: 9.5, color: C.ink })
    p.y -= 6
  }

  p.heading('Payments (Whitechain)')
  if (!result.payments.length) p.wrap('No payments recorded.', M, W - 2 * M, { size: 9.5, color: C.muted })
  for (const pay of result.payments) {
    p.ensure(34)
    p.text(`${money(pay.amount)} USDT${pay.payer ? ` from ${short(pay.payer, 8)}` : ''}${pay.gasless ? '  (gasless)' : ''}`, M, p.y, { size: 10, font: fonts.bold })
    p.y -= 13
    p.text(`tx ${pay.txHash}`, M, p.y, { size: 7.5, font: fonts.mono, color: C.muted })
    p.y -= 11
    p.text(pay.explorer, M, p.y, { size: 7.5, font: fonts.mono, color: C.muted })
    p.y -= 16
  }
  for (const r of result.refunds || []) {
    p.ensure(24)
    p.text(`Refund ${money(r.amount)} USDT${r.to ? ` to ${short(r.to, 8)}` : ''}  tx ${short(r.txHash, 12)}`, M, p.y, { size: 9, color: C.amber })
    p.y -= 16
  }

  p.heading('Evidence')
  p.kv([
    ['Registry (Whitechain)', short(result.chain.registry, 12)],
    ['Document hash (onchain)', short(inv.docHash, 12)],
    ['Receipt NFT', result.receipt.exists ? `#${result.id} minted (held by a dead address)` : 'none'],
    ['Issuer wallet', inv.issuer ? short(inv.issuer, 10) : 'Sealed'],
    ['ENS issuer status', `${result.ens.issuer?.status ?? (locked ? 'Sealed' : '-')}${result.ens.issuer?.expiry ? `, expires ${longDate(result.ens.issuer.expiry)}` : ''}`],
    ['ENS employer', result.ens.issuer?.records?.['hisaab.employer'] ?? (locked ? 'Sealed' : '-')],
  ])

  p.ensure(60)
  p.y -= 6
  p.wrap(`Verify live: ${verifyUrl(result.id)}`, M, W - 2 * M, { size: 9, font: fonts.bold })
  p.wrap(
    `Generated ${new Date(result.checkedAt).toUTCString()}. This statement shows that a payment was received against this invoice and who issued it. It does not prove the work was done, the counterparty's identity beyond ENS, or tax treatment.${document ? ' It includes the private invoice details, so share it with care.' : ''}`,
    M, W - 2 * M, { size: 7.5, color: C.muted },
  )
  await attachAll(doc, result.id)
  return doc.save()
}

export async function invoicePdf(id, sealed, inv) {
  const { doc, fonts } = await base(`Hisaab invoice #${id} (sealed)`)
  const p = new Page(doc, fonts)
  await band(p, 'Sealed invoice', `Invoice #${id} on Whitechain. Details are encrypted inside this PDF.`, id)
  p.heading('Public facts (onchain)')
  p.kv([
    ['Invoice', `#${id}`],
    ['Status', inv.status],
    ['Amount', `${money(inv.amount)} USDT`],
    ['Paid', inv.paid > 0n ? `${money(inv.paid)} USDT` : 'not yet'],
    ['Created', longDate(inv.createdAt)],
    ['Due', longDate(inv.dueDate)],
  ])
  p.kv([['Document fingerprint', short(inv.docHash, 12)], ['Registry', short(config.registry, 12)]])
  p.heading('Who it is between')
  p.wrap('Sealed. The parties, their ENS names, wallets and line items are encrypted inside this file (AES-256-GCM).', M, W - 2 * M, { size: 10.5, font: fonts.bold })
  p.y -= 4
  p.wrap(`To read them, open ${verifyUrl(id)}, drop this PDF and enter the invoice key (it starts with HSB${id}-). The issuer shares the key separately. This PDF alone, or the key alone, shows nothing beyond the facts above.`, M, W - 2 * M, { size: 9.5 })
  p.y -= 10
  p.wrap('The key is checked in your browser. The decrypted invoice is then compared with the fingerprint stored onchain, so a changed or swapped document shows up as a red check.', M, W - 2 * M, { size: 8.5, color: C.muted })
  await attachAll(doc, id, sealed)
  return doc.save()
}

function decodeName(obj) {
  return typeof obj?.decodeText === 'function' ? obj.decodeText() : String(obj)
}

export async function extractAttachments(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  const out = {}
  const walk = (node) => {
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
    if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i, PDFDict))
    const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray)
    if (!arr) return
    for (let i = 0; i + 1 < arr.size(); i += 2) {
      const name = decodeName(arr.lookup(i))
      const spec = arr.lookup(i + 1, PDFDict)
      const stream = spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.lookupMaybe(PDFName.of('F'), PDFRawStream)
      if (stream) out[name] = Buffer.from(decodePDFRawStream(stream).decode()).toString('utf8')
    }
  }
  if (embedded) walk(embedded)
  return out
}
