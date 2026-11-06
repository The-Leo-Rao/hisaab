import { zeroAddress } from 'viem'
import { namehash } from 'viem/ens'
import { config, verifyUrl } from './config.mjs'
import { normalizeName, readName } from './ens-read.mjs'
import { docHash, isoDate, longDate, money } from './invoice.mjs'
import { getInvoice, payments, receipt, refunds } from './whitechain.mjs'

const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const row = (key, label, tone, text, evidence = {}) => ({ key, label, tone, text, evidence })

function hashCheck(inv, document) {
  if (!document) return row('hash', 'A · Document', 'grey', 'No document supplied. Only onchain facts are shown.')
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

function issuerCheck(inv, ensIssuer) {
  const name = inv.issuerName
  if (!name) return row('issuer', 'B · Issuer', 'red', 'The invoice names no issuer.')
  const normalized = normalizeName(name)
  const nodeOk = normalized ? same(namehash(normalized), inv.issuerNode) : false
  if (!ensIssuer.valid || ensIssuer.status === 'unregistered' || ensIssuer.status === 'available') {
    return row('issuer', 'B · Issuer', 'red', `${name} is not a registered ENS name.`, { name, nodeOk })
  }
  if (ensIssuer.revoked) {
    return row('issuer', 'B · Issuer', 'red', `${name} was revoked on ${longDate(ensIssuer.expiry)}. It no longer vouches for this issuer.`, { name, revokedAt: ensIssuer.expiry, nodeOk })
  }
  const walletOk = same(ensIssuer.wallet, inv.issuer)
  const backlink = ensIssuer.records?.['hisaab.registry']
  const backlinkOk = same(backlink, `${config.wcChainId}:${config.registry}`)
  const evidence = { name, ensWallet: ensIssuer.wallet, issuer: inv.issuer, backlink, nodeOk, walletOk, backlinkOk }
  if (walletOk && backlinkOk && nodeOk) {
    return row('issuer', 'B · Issuer', 'green', `${name} points to the wallet that issued this invoice and links back to this registry.`, evidence)
  }
  if (!walletOk) {
    return row('issuer', 'B · Issuer', 'red', `${name} does not point to the issuing wallet${ensIssuer.wallet ? '' : ' (no hisaab.wallet record)'}.`, evidence)
  }
  const missing = [!backlinkOk && 'hisaab.registry back-link', !nodeOk && 'namehash'].filter(Boolean).join(' and ')
  return row('issuer', 'B · Issuer', 'amber', `${name} points to the issuer, but the ${missing} does not match.`, evidence)
}

function standingCheck(inv, ensIssuer) {
  if (!ensIssuer.valid || ensIssuer.status === 'unregistered' || ensIssuer.status === 'available') {
    return row('standing', 'C · Standing', 'red', `${inv.issuerName || 'The issuer name'} is revoked or was never registered.`, { status: ensIssuer.status })
  }
  if (ensIssuer.revoked) {
    const parent = inv.issuerName.split('.').slice(-2).join('.')
    const before = ensIssuer.expiry > inv.createdAt ? ' This invoice was issued before the revocation.' : ' This invoice was issued after the revocation.'
    return row('standing', 'C · Standing', 'red', `Revoked by its parent (${parent}) on ${longDate(ensIssuer.expiry)}.${before}`, { status: 'revoked', revokedAt: ensIssuer.expiry, createdAt: inv.createdAt })
  }
  const r = ensIssuer.records || {}
  const employer = r['hisaab.employer']
  const issuedOk = !ensIssuer.expiry || ensIssuer.expiry > inv.createdAt
  const evidence = { status: ensIssuer.status, expiry: ensIssuer.expiry, createdAt: inv.createdAt, employer, role: r['hisaab.role'], client: r['hisaab.client'], approved: r['hisaab.approved'] }
  if (employer) {
    const vouched = inv.issuerName.endsWith(`.${employer}`)
    const role = r['hisaab.role'] ? ` as ${r['hisaab.role']}` : ''
    if (!vouched) return row('standing', 'C · Standing', 'amber', `Claims ${employer} as employer, but the name is not issued under it.`, evidence)
    if (ensIssuer.status === 'expired') {
      return row('standing', 'C · Standing', 'amber', `Contract with ${employer}${role} ended on ${longDate(ensIssuer.expiry)}.${issuedOk ? ' It was active when this invoice was issued.' : ''}`, evidence)
    }
    return row('standing', 'C · Standing', issuedOk ? 'green' : 'amber', `Vouched by ${employer}${role}; active until ${longDate(ensIssuer.expiry) ?? 'no expiry'}.`, evidence)
  }
  const approved = r['hisaab.approved'] && r['hisaab.approved'].split(',').map((s) => s.trim()).includes(`invoice:${inv.id}`)
  const ack = approved ? ` ${r['hisaab.client'] || 'The client'} acknowledged this invoice on ENS.` : ''
  if (ensIssuer.status === 'expired') {
    return row('standing', 'C · Standing', 'amber', `Engagement name expired on ${longDate(ensIssuer.expiry)}.${issuedOk ? ' It was active when this invoice was issued.' : ''}${ack}`, evidence)
  }
  return row('standing', 'C · Standing', 'green', `Name active until ${longDate(ensIssuer.expiry) ?? 'no expiry'}.${ack}`, evidence)
}

function paymentCheck(inv, pays, rcpt) {
  const sum = pays.reduce((s, p) => s + p.amount, 0n)
  const eventsOk = sum === inv.paid
  const receiptOk = rcpt.exists && same(rcpt.owner, inv.issuer)
  const evidence = { paid: inv.paid, refunded: inv.refunded, sumOfEvents: sum, receiptOwner: rcpt.owner, txs: pays.map((p) => p.txHash) }
  if (inv.status === 'Paid' && eventsOk && receiptOk) {
    if (inv.refunded > 0n) {
      return row('payment', 'D · Payment', 'amber', `${money(inv.paid)} USDT received, later ${money(inv.refunded)} refunded. Net ${money(inv.paid - inv.refunded)} USDT.`, evidence)
    }
    return row('payment', 'D · Payment', 'green', `${money(inv.paid)} USDT received in full on ${longDate(inv.paidAt)}. Receipt #${inv.id} is held by the issuer.`, evidence)
  }
  if (inv.status === 'Refunded') return row('payment', 'D · Payment', 'red', `Payment of ${money(inv.paid)} USDT was fully refunded.`, evidence)
  if (inv.paid > 0n) return row('payment', 'D · Payment', 'amber', `Partly paid: ${money(inv.paid)} of ${money(inv.amount)} USDT.`, evidence)
  if (inv.status === 'Cancelled') return row('payment', 'D · Payment', 'red', 'Invoice was cancelled before payment.', evidence)
  return row('payment', 'D · Payment', 'red', 'No payment received yet.', evidence)
}

function clientCheck(inv, ensClient) {
  if (inv.payer === zeroAddress) return row('client', 'Client', 'grey', 'Nobody has paid yet.')
  if (!inv.clientName) return row('client', 'Client', 'grey', 'Payer not identified (no client name on the invoice).', { payer: inv.payer })
  if (ensClient?.valid && same(ensClient.wallet, inv.payer)) {
    return row('client', 'Client', 'green', `Paid by ${inv.clientName} (its ENS wallet matches the payer).`, { payer: inv.payer, ensWallet: ensClient.wallet })
  }
  return row('client', 'Client', 'grey', `Payer not identified: ${inv.clientName} does not point to the paying wallet.`, { payer: inv.payer, ensWallet: ensClient?.wallet ?? null })
}

export async function verifyInvoice(id, document) {
  const inv = await getInvoice(id)
  if (!inv) return { id: String(id), exists: false }
  const [pays, refs, rcpt, ensIssuer, ensClient] = await Promise.all([
    payments(id),
    refunds(id),
    receipt(id),
    readName(inv.issuerName),
    inv.clientName ? readName(inv.clientName) : Promise.resolve(null),
  ])
  const checks = [
    hashCheck(inv, document),
    issuerCheck(inv, ensIssuer),
    standingCheck(inv, ensIssuer),
    paymentCheck(inv, pays, rcpt),
    clientCheck(inv, ensClient),
  ]
  const tone = Object.fromEntries(checks.map((c) => [c.key, c.tone]))
  const verified = tone.hash === 'green' && tone.issuer === 'green' && tone.payment === 'green'
  const kind = ensIssuer.records?.['hisaab.employer'] ? 'contractor' : 'freelance'
  const summary = verified
    ? `This invoice was issued by ${inv.issuerName}, has not been altered, and ${money(inv.paid)} USDT was received against it on ${longDate(inv.paidAt)}.`
    : null
  return {
    id: String(id),
    exists: true,
    verified,
    kind,
    summary,
    checks,
    invoice: {
      ...inv,
      createdAtIso: isoDate(inv.createdAt),
      dueDateIso: isoDate(inv.dueDate),
      paidAtIso: isoDate(inv.paidAt),
      amountText: money(inv.amount),
      paidText: money(inv.paid),
      refundedText: money(inv.refunded),
    },
    payments: pays,
    refunds: refs,
    receipt: { exists: rcpt.exists, owner: rcpt.owner, tokenId: String(id), contract: rcpt.contract, image: rcpt.image ?? null, external_url: rcpt.external_url ?? null },
    ens: { issuer: ensIssuer, client: ensClient },
    chain: { chainId: config.wcChainId, registry: config.registry, receipt: config.receipt, usdt: config.usdt, explorer: config.explorer },
    links: { verify: verifyUrl(id) },
    checkedAt: new Date().toISOString(),
  }
}
