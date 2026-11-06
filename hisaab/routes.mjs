import { readFileSync } from 'node:fs'
import { isSealedInvoice } from './commit.mjs'
import { config, requireDeployment, verifyUrl } from './config.mjs'
import { readName } from './ens-read.mjs'
import { prepareApproval, prepareClientApprovalRole, prepareRecords, recordPlan } from './ens-records.mjs'
import { decodeFragmentDoc, jsonSafe } from './invoice.mjs'
import { extractAttachments, invoicePdf, statementPdf } from './pdf.mjs'
import { qrPng, qrSvg } from './qr.mjs'
import { verifyInvoice } from './verify.mjs'
import { getInvoice, payments, receipt, refunds } from './whitechain.mjs'

const MAX_BODY = 6 * 1024 * 1024
const page = () => readFileSync(new URL('./public/verify.html', import.meta.url), 'utf8')

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' }

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, ...cors, ...extra })
  res.end(type.startsWith('application/json') ? JSON.stringify(jsonSafe(body)) : body)
}

async function body(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw fail('Request body too large (max 6 MB).', 413)
    chunks.push(c)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text || '{}')
  } catch {
    throw fail('Body must be valid JSON.')
  }
}

function parseId(v) {
  if (!/^\d{1,30}$/.test(String(v ?? ''))) throw fail('id must be a positive integer.')
  return BigInt(v)
}

async function documentFrom(b) {
  if (b.document) return typeof b.document === 'string' ? JSON.parse(b.document) : b.document
  if (b.fragment) return decodeFragmentDoc(b.fragment)
  return null
}

async function fromPdf(b) {
  if (!b.pdf) return {}
  const files = await extractAttachments(Buffer.from(String(b.pdf).replace(/^data:[^,]*,/, ''), 'base64'))
  const meta = files['hisaab-meta.json'] ? JSON.parse(files['hisaab-meta.json']) : null
  const document = files['invoice.json'] ? JSON.parse(files['invoice.json']) : null
  const sealed = files['invoice.enc'] ? JSON.parse(files['invoice.enc']) : null
  if (!meta && !document && !sealed) throw fail('No Hisaab attachments (invoice.enc / hisaab-meta.json) found in this PDF.')
  if (sealed && !isSealedInvoice(sealed)) throw fail('The sealed invoice inside this PDF is damaged.')
  return { meta, document, sealed }
}

const pdfHeaders = (name) => ({ 'content-disposition': `inline; filename="${name}"` })

export async function handleHisaab(req, res, url) {
  const p = url.pathname
  const m = (re) => p.match(re)
  const GET = req.method === 'GET'
  const POST = req.method === 'POST'
  let x

  if (GET && (p === '/verify' || p === '/verify/' || m(/^\/verify\/\d+$/))) return send(res, 200, page(), 'text/html; charset=utf-8')

  if (GET && p === '/api/v1/hisaab/status') {
    return send(res, 200, {
      whitechain: { chainId: config.wcChainId, rpc: config.wcRpc, registry: config.registry, receipt: config.receipt, usdt: config.usdt, deployBlock: config.deployBlock, explorer: config.explorer },
      publicBase: config.publicBase,
      verifyPage: `${config.publicBase}/verify/:id`,
      configured: !!(config.registry && config.receipt),
    })
  }

  if (GET && (x = m(/^\/api\/v1\/hisaab\/invoice\/(\d+)$/))) {
    const id = parseId(x[1])
    const inv = await getInvoice(id)
    if (!inv) throw fail(`Invoice #${id} does not exist.`, 404)
    const [pays, refs, rcpt] = await Promise.all([payments(id), refunds(id), receipt(id)])
    return send(res, 200, { invoice: inv, payments: pays, refunds: refs, receipt: { exists: rcpt.exists, owner: rcpt.owner }, verifyUrl: verifyUrl(id) })
  }

  if (GET && (x = m(/^\/api\/v1\/hisaab\/receipt\/(\d+)$/))) {
    const r = await receipt(parseId(x[1]))
    if (!r.exists) throw fail('No receipt NFT for this invoice (not fully paid, or burned after a full refund).', 404)
    return send(res, 200, r)
  }

  if (GET && (x = m(/^\/api\/v1\/hisaab\/verify\/(\d+)$/))) {
    const r = await verifyInvoice(parseId(x[1]), null)
    return send(res, r.exists ? 200 : 404, r)
  }

  if (POST && p === '/api/v1/hisaab/verify') {
    const b = await body(req)
    const pdf = await fromPdf(b)
    const id = parseId(b.id ?? pdf.meta?.id ?? pdf.sealed?.id)
    if (pdf.sealed && pdf.sealed.id !== String(id)) throw fail(`This PDF seals invoice #${pdf.sealed.id}, not #${id}.`, 409)
    const document = pdf.document ?? (await documentFrom(b))
    const r = await verifyInvoice(id, document)
    const sealed = pdf.sealed && !document ? pdf.sealed : null
    return send(res, r.exists ? 200 : 404, { ...r, document: document ?? null, sealedDocument: sealed, needsKey: !!sealed, source: b.pdf ? 'pdf' : document ? 'json' : 'none' })
  }

  if (GET && (x = m(/^\/api\/v1\/hisaab\/qr\/(\d+)\.(svg|png)$/))) {
    const link = verifyUrl(parseId(x[1]))
    const size = Math.min(Math.max(Number(url.searchParams.get('size')) || 480, 120), 2048)
    return x[2] === 'svg' ? send(res, 200, await qrSvg(link), 'image/svg+xml') : send(res, 200, await qrPng(link, size), 'image/png')
  }

  if ((GET && (x = m(/^\/api\/v1\/hisaab\/statement\/(\d+)\.pdf$/))) || (POST && p === '/api/v1/hisaab/statement')) {
    requireDeployment()
    const b = POST ? await body(req) : {}
    const id = parseId(x ? x[1] : b.id)
    const document = POST ? await documentFrom(b) : null
    const r = await verifyInvoice(id, document)
    if (!r.exists) throw fail(`Invoice #${id} does not exist.`, 404)
    return send(res, 200, Buffer.from(await statementPdf(r, document)), 'application/pdf', pdfHeaders(`hisaab-statement-${id}.pdf`))
  }

  if (POST && p === '/api/v1/hisaab/invoice-pdf') {
    const b = await body(req)
    const id = parseId(b.id)
    const sealed = b.sealed
    if (!isSealedInvoice(sealed)) throw fail('sealed is required: the invoice encrypted in the browser with its invoice key. This API never builds a plaintext invoice PDF.')
    if (sealed.id !== String(id)) throw fail(`sealed belongs to invoice #${sealed.id}, not #${id}.`, 409)
    const inv = await getInvoice(id)
    if (!inv) throw fail(`Invoice #${id} does not exist.`, 404)
    if (sealed.docHash.toLowerCase() !== inv.docHash.toLowerCase()) throw fail('This sealed invoice does not match the onchain hash of invoice #' + id + '.', 409)
    return send(res, 200, Buffer.from(await invoicePdf(id, sealed, inv)), 'application/pdf', pdfHeaders(`invoice-${id}-sealed.pdf`))
  }

  if (GET && p === '/api/v1/hisaab/ens/name') {
    const name = url.searchParams.get('name')
    if (!name) throw fail('Provide ?name=')
    return send(res, 200, await readName(name))
  }

  if (POST && p === '/api/v1/hisaab/ens/records') {
    const b = await body(req)
    const records = b.records ?? recordPlan(b)
    return send(res, 200, { records, ...(await prepareRecords({ name: b.name, from: b.from, records })) })
  }

  if (POST && p === '/api/v1/hisaab/ens/client-role') return send(res, 200, await prepareClientApprovalRole(await body(req)))
  if (POST && p === '/api/v1/hisaab/ens/approve') return send(res, 200, await prepareApproval(await body(req)))

  return false
}

export function isHisaabRoute(pathname) {
  return pathname.startsWith('/api/v1/hisaab') || pathname === '/verify' || pathname.startsWith('/verify/')
}
