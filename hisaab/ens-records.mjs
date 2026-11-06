import { encodeFunctionData, isAddress, parseAbi, stringToHex, toHex } from 'viem'
import { packetToBytes } from 'viem/ens'
import { approvalCommitment, isHex32, walletCommitment } from './commit.mjs'
import { config } from './config.mjs'
import { ens, normalizeName, readName } from './ens-read.mjs'

const resolverAbi = parseAbi([
  'function setData(bytes name, string key, bytes value)',
  'function grantSetterRoles(bytes setter, address account) returns (bool)',
])

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

function tx(action, name, from, to, data, metadata = {}) {
  return {
    action,
    name,
    from,
    to,
    data,
    chainId: ens.chain.id,
    ...metadata,
    value: '0x0',
    metadata,
    note: 'Unsigned transaction. Send it from the connected wallet; this API never stores a key or broadcasts.',
  }
}

export function sealedWallet({ issuer, nameSalt, walletCommitment: given }) {
  if (isHex32(given)) return given
  if (!issuer || !isAddress(issuer)) throw fail('Send walletCommitment (keccak256 of the issuer wallet and its name secret), or issuer plus nameSalt.')
  if (!isHex32(nameSalt)) throw fail('nameSalt must be 32 bytes. Hisaab never publishes a plain issuer wallet on ENS.')
  return walletCommitment(issuer, nameSalt)
}

export function recordPlan({ name, issuer, nameSalt, walletCommitment: given, kind = 'freelance', employer, role, client }) {
  if (!normalizeName(name)) throw fail('name must be a valid ENS name.')
  const sealed = sealedWallet({ issuer, nameSalt, walletCommitment: given })
  if (!config.registry) throw fail('Hisaab registry is not configured on this server.', 503)
  const records = [
    { key: 'hisaab.registry', value: `${config.wcChainId}:${config.registry}` },
    { key: 'hisaab.wallet', value: sealed },
  ]
  if (kind === 'contractor') {
    if (!employer) throw fail('employer is required for contractor names, for example acme-labs.eth.')
    records.push({ key: 'hisaab.employer', value: employer })
    if (role) records.push({ key: 'hisaab.role', value: role })
  }
  if (kind === 'freelance' && client) records.push({ key: 'hisaab.client', value: client })
  return records
}

async function viaTeammateEndpoint(name, from, record) {
  const res = await fetch(`${config.selfBase}/api/v1/ens/subchildren/set-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, from, data: { key: record.key, value: record.value } }),
  })
  const body = await res.json()
  if (!res.ok) throw fail(`set-data for ${record.key}: ${body.error}`, res.status)
  return body
}

async function resolverFor(name) {
  const info = await readName(name, [])
  if (!info.valid || !info.resolver) throw fail(`${name} has no resolver. Register it with a resolver first.`, 409)
  return info.resolver
}

export async function prepareRecords({ name, from, records }) {
  const n = normalizeName(name)
  if (!n) throw fail('name must be a valid ENS name.')
  if (!from || !isAddress(from)) throw fail('from must be the wallet that controls the name.')
  if (!Array.isArray(records) || !records.length) throw fail('records must be a non-empty array of { key, value }.')
  const isSubname = n.split('.').length >= 3
  const out = []
  for (const r of records) {
    if (isSubname) out.push(await viaTeammateEndpoint(n, from, r))
    else {
      const resolver = await resolverFor(n)
      const encoded = stringToHex(r.value)
      const data = encodeFunctionData({ abi: resolverAbi, functionName: 'setData', args: [toHex(packetToBytes(n)), r.key, encoded] })
      out.push(tx('set-name-data', n, from, resolver, data, { key: r.key, encodedValue: encoded, value: encoded, recordValue: r.value }))
    }
  }
  return { name: n, via: isSubname ? '/api/v1/ens/subchildren/set-data' : 'direct setData', transactions: out }
}

export async function prepareClientApprovalRole({ name, from, client }) {
  const n = normalizeName(name)
  if (!n) throw fail('name must be a valid ENS name.')
  if (!isAddress(from) || !isAddress(client)) throw fail('from and client must be addresses.')
  const resolver = await resolverFor(n)
  const setter = encodeFunctionData({ abi: resolverAbi, functionName: 'setData', args: ['0x', 'hisaab.approved', '0x'] })
  const data = encodeFunctionData({ abi: resolverAbi, functionName: 'grantSetterRoles', args: [setter, client] })
  return tx('grant-client-approval', n, from, resolver, data, { client, key: 'hisaab.approved' })
}

export async function prepareApproval({ name, from, approval, invoiceId, salt }) {
  const n = normalizeName(name)
  if (!n) throw fail('name must be a valid ENS name.')
  if (!isAddress(from)) throw fail('from must be the client wallet.')
  let entry = isHex32(approval) ? approval.toLowerCase() : null
  if (!entry && /^\d+$/.test(String(invoiceId ?? '')) && isHex32(salt)) entry = approvalCommitment(invoiceId, salt).toLowerCase()
  if (!entry) throw fail('Send approval (keccak256 of the invoice id and the invoice salt), or invoiceId plus salt. Plain invoice ids are not written to ENS.')
  const info = await readName(n, ['hisaab.approved'])
  if (!info.resolver) throw fail(`${n} has no resolver.`, 409)
  const existing = (info.records['hisaab.approved'] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const value = existing.includes(entry) ? existing.join(',') : [...existing, entry].join(',')
  const encoded = stringToHex(value)
  const data = encodeFunctionData({ abi: resolverAbi, functionName: 'setData', args: [toHex(packetToBytes(n)), 'hisaab.approved', encoded] })
  return tx('client-approve-invoice', n, from, info.resolver, data, { key: 'hisaab.approved', encodedValue: encoded, value: encoded, recordValue: value })
}
