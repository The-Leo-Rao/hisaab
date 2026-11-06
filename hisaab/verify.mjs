import { zeroAddress } from 'viem'
import { namehash } from 'viem/ens'
import { approvalListed, isHex32, issuerCommitment, walletMatches } from './commit.mjs'
import { config, verifyUrl } from './config.mjs'
import { normalizeName, readName } from './ens-read.mjs'
import { docHash, isoDate, longDate, money } from './invoice.mjs'
import { getInvoice, payments, receipt, refunds } from './whitechain.mjs'

export const RECEIPT_SINK = '0x000000000000000000000000000000000000dEaD'

const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const row = (key, label, tone, text, evidence = {}) => ({ key, label, tone, text, evidence })

function hashCheck(inv, document) {
  if (!document) {
    return inv.issuerName
      ? row('hash', 'A · Document', 'grey', 'No document supplied. Only onchain facts are shown.')
      : row('hash', 'A · Document', 'grey', 'Sealed. Drop the invoice PDF and enter its invoice key to see who it is between.')
  }
  let computed
  try {
    computed = docHash(document)
  } catch {
    return row('hash', 'A · Document', 'red', 'The supplied document is not valid JSON.')
  }
  return same(computed, inv.docHash)
    ? row('hash', 'A · Document', 'green', 'The document matches the onchain fingerprint. It has not been altered.', { computed, onchain: inv.docHash })
    : row('hash', 'A · Document', 'red', 'The document does NOT match the onchain fingerprint.', { computed, onchain: inv.docHash })
}

function identity(inv, document, docOk) {
  if (inv.issuerName) {
    return { sealed: false, name: inv.issuerName, client: inv.clientName, nameSalt: null, salt: null, nodeOk: same(namehash(normalizeName(inv.issuerName) ?? inv.issuerName), inv.issuerNode) }
  }
  if (!document || !docOk) return { sealed: true, name: null, client: null, nameSalt: null, salt: null, nodeOk: false }
  const name = document.supplier?.ens || null
  const salt = isHex32(document.salt) ? document.salt : null
  const nodeOk = !!name && !!salt && same(issuerCommitment(name, salt), inv.issuerNode)
  return { sealed: true, name, client: document.customer?.ens || null, nameSalt: document.supplier?.nameSalt ?? null, salt, nodeOk }
}

function issuerCheck(inv, id, ensIssuer) {
  const name = id.name
  if (!name) return row('issuer', 'B · Issuer', 'red', 'The invoice names no issuer.')
  if (!ensIssuer.valid || ensIssuer.status === 'unregistered' || ensIssuer.status === 'available') {
    return row('issuer', 'B · Issuer', 'red', `${name} is not a registered ENS name.`, { name, nodeOk: id.nodeOk })
  }
  if (ensIssuer.revoked) {
    return row('issuer', 'B · Issuer', 'red', `${name} was revoked on ${longDate(ensIssuer.expiry)}. It no longer vouches for this issuer.`, { name, revokedAt: ensIssuer.expiry, nodeOk: id.nodeOk })
  }
  const record = ensIssuer.records?.['hisaab.wallet'] ?? null
  const walletOk = walletMatches(record, inv.issuer, id.nameSalt)
  const sealedRecord = isHex32(record)
  const backlink = ensIssuer.records?.['hisaab.registry']
  const backlinkOk = same(backlink, `${config.wcChainId}:${config.registry}`)
  const nodeOk = id.nodeOk
  const evidence = { name, issuer: inv.issuer, walletRecord: record, sealedRecord, backlink, nodeOk, walletOk, backlinkOk }
  if (walletOk && backlinkOk && nodeOk) {
    const how = sealedRecord ? 'Its sealed wallet record matches the wallet that issued this invoice' : `${name} points to the wallet that issued this invoice`
    return row('issuer', 'B · Issuer', 'green', `${how}, and it links back to this registry.`, evidence)
  }
  if (!walletOk) {
    return row('issuer', 'B · Issuer', 'red', `${name} does not match the issuing wallet${record ? '' : ' (no hisaab.wallet record)'}.`, evidence)
  }
  const missing = [!backlinkOk && 'hisaab.registry back-link', !nodeOk && (id.sealed ? 'issuer commitment' : 'namehash')].filter(Boolean).join(' and ')
  return row('issuer', 'B · Issuer', 'amber', `${name} matches the issuer, but the ${missing} does not.`, evidence)
}

function standingCheck(inv, id, ensIssuer) {
  const name = id.name
  if (!ensIssuer.valid || ensIssuer.status === 'unregistered' || ensIssuer.status === 'available') {
    return row('standing', 'C · Standing', 'red', `${name || 'The issuer name'} is revoked or was never registered.`, { status: ensIssuer.status })
  }
  if (ensIssuer.revoked) {
    const parent = name.split('.').slice(-2).join('.')
    const before = ensIssuer.expiry > inv.createdAt ? ' This invoice was issued before the revocation.' : ' This invoice was issued after the revocation.'
    return row('standing', 'C · Standing', 'red', `Revoked by its parent (${parent}) on ${longDate(ensIssuer.expiry)}.${before}`, { status: 'revoked', revokedAt: ensIssuer.expiry, createdAt: inv.createdAt })
  }
  const r = ensIssuer.records || {}
  const employer = r['hisaab.employer']
  const issuedOk = !ensIssuer.expiry || ensIssuer.expiry > inv.createdAt
  const evidence = { status: ensIssuer.status, expiry: ensIssuer.expiry, createdAt: inv.createdAt, employer, role: r['hisaab.role'], client: r['hisaab.client'] }
  if (employer) {
    const vouched = name.endsWith(`.${employer}`)
    const role = r['hisaab.role'] ? ` as ${r['hisaab.role']}` : ''
    if (!vouched) return row('standing', 'C · Standing', 'amber', `Claims ${employer} as employer, but the name is not issued under it.`, evidence)
    if (ensIssuer.status === 'expired') {
      return row('standing', 'C · Standing', 'amber', `Contract with ${employer}${role} ended on ${longDate(ensIssuer.expiry)}.${issuedOk ? ' It was active when this invoice was issued.' : ''}`, evidence)
    }
    return row('standing', 'C · Standing', issuedOk ? 'green' : 'amber', `Vouched by ${employer}${role}; active until ${longDate(ensIssuer.expiry) ?? 'no expiry'}.`, evidence)
  }
  const approved = approvalListed(r['hisaab.approved'], inv.id, id.salt)
  const ack = approved ? ` ${r['hisaab.client'] || 'The client'} acknowledged this invoice on ENS.` : ''
  if (ensIssuer.status === 'expired') {
    return row('standing', 'C · Standing', 'amber', `Engagement name expired on ${longDate(ensIssuer.expiry)}.${issuedOk ? ' It was active when this invoice was issued.' : ''}${ack}`, { ...evidence, approved })
  }
  return row('standing', 'C · Standing', 'green', `Name active until ${longDate(ensIssuer.expiry) ?? 'no expiry'}.${ack}`, { ...evidence, approved })
}

function paymentCheck(inv, pays, rcpt) {
  const sum = pays.reduce((s, p) => s + p.amount, 0n)
  const eventsOk = sum === inv.paid
  const receiptOk = rcpt.exists && (same(rcpt.owner, RECEIPT_SINK) || same(rcpt.owner, inv.issuer))
  const evidence = { paid: inv.paid, refunded: inv.refunded, sumOfEvents: sum, receiptOwner: rcpt.owner, txs: pays.map((p) => p.txHash) }
  if (inv.status === 'Paid' && eventsOk && receiptOk) {
    if (inv.refunded > 0n) {
      return row('payment', 'D · Payment', 'amber', `${money(inv.paid)} USDT received, later ${money(inv.refunded)} refunded. Net ${money(inv.paid - inv.refunded)} USDT.`, evidence)
    }
    return row('payment', 'D · Payment', 'green', `${money(inv.paid)} USDT received in full on ${longDate(inv.paidAt)}. Receipt #${inv.id} was minted.`, evidence)
  }
  if (inv.status === 'Refunded') return row('payment', 'D · Payment', 'red', `Payment of ${money(inv.paid)} USDT was fully refunded.`, evidence)
  if (inv.paid > 0n) return row('payment', 'D · Payment', 'amber', `Partly paid: ${money(inv.paid)} of ${money(inv.amount)} USDT.`, evidence)
  if (inv.status === 'Cancelled') return row('payment', 'D · Payment', 'red', 'Invoice was cancelled before payment.', evidence)
  return row('payment', 'D · Payment', 'red', 'No payment received yet.', evidence)
}

function clientCheck(inv, id, ensClient) {
  if (inv.payer === zeroAddress) return row('client', 'Client', 'grey', 'Nobody has paid yet.')
  if (!id.client) return row('client', 'Client', 'grey', id.sealed ? 'Payer not shown. It is part of the sealed details.' : 'Payer not identified (no client name on the invoice).', { payer: id.sealed ? null : inv.payer })
  if (ensClient?.valid && same(ensClient.wallet, inv.payer)) {
    return row('client', 'Client', 'green', `Paid by ${id.client} (its ENS wallet matches the payer).`, { payer: inv.payer, ensWallet: ensClient.wallet })
  }
  return row('client', 'Client', 'grey', `Payer not identified: ${id.client} does not point to the paying wallet.`, { payer: inv.payer, ensWallet: ensClient?.wallet ?? null })
}

function publicInvoice(inv, sealed) {
  const out = {
    ...inv,
    createdAtIso: isoDate(inv.createdAt),
    dueDateIso: isoDate(inv.dueDate),
    paidAtIso: isoDate(inv.paidAt),
    amountText: money(inv.amount),
    paidText: money(inv.paid),
    refundedText: money(inv.refunded),
  }
  return sealed ? { ...out, issuer: null, client: null, payer: null, issuerNode: null } : out
}

export async function verifyInvoice(id, document) {
  const inv = await getInvoice(id)
  if (!inv) return { id: String(id), exists: false }
  const [pays, refs, rcpt] = await Promise.all([payments(id), refunds(id), receipt(id)])
  const hash = hashCheck(inv, document)
  const who = identity(inv, document, hash.tone === 'green')
  const locked = who.sealed && !who.name
  const [ensIssuer, ensClient] = locked
    ? [null, null]
    : await Promise.all([readName(who.name), who.client ? readName(who.client) : Promise.resolve(null)])
  const checks = locked
    ? [hash, paymentCheck(inv, pays, rcpt)]
    : [hash, issuerCheck(inv, who, ensIssuer), standingCheck(inv, who, ensIssuer), paymentCheck(inv, pays, rcpt), clientCheck(inv, who, ensClient)]
  const tone = Object.fromEntries(checks.map((c) => [c.key, c.tone]))
  const verified = tone.hash === 'green' && tone.issuer === 'green' && tone.payment === 'green'
  const kind = locked ? null : ensIssuer.records?.['hisaab.employer'] ? 'contractor' : 'freelance'
  const summary = verified
    ? `This invoice was issued by ${who.name}, has not been altered, and ${money(inv.paid)} USDT was received against it on ${longDate(inv.paidAt)}.`
    : null
  const hide = (list) => (locked ? list.map(({ payer, to, ...rest }) => rest) : list)
  return {
    id: String(id),
    exists: true,
    sealed: who.sealed,
    unlocked: who.sealed && !locked,
    verified,
    kind,
    summary,
    checks,
    invoice: publicInvoice(inv, locked),
    payments: hide(pays),
    refunds: hide(refs),
    receipt: { exists: rcpt.exists, owner: rcpt.owner, tokenId: String(id), contract: rcpt.contract, image: rcpt.image ?? null, external_url: rcpt.external_url ?? null },
    ens: { issuer: ensIssuer, client: ensClient },
    chain: { chainId: config.wcChainId, registry: config.registry, receipt: config.receipt, usdt: config.usdt, explorer: config.explorer },
    links: { verify: verifyUrl(id) },
    checkedAt: new Date().toISOString(),
  }
}
