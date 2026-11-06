import { encodeFunctionData, isAddress, keccak256, parseAbi, stringToHex, toHex } from 'viem'
import { packetToBytes } from 'viem/ens'
import { config } from './config.mjs'
import { ens, normalizeName, readName } from './ens-read.mjs'

const ROLE_SET_DATA = 1n << 24n
const resolverAbi = parseAbi([
  'function setData(bytes name, string key, bytes value)',
  'function grantRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)',
])

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

function tx(action, name, from, to, data, metadata = {}) {
  return {
    action,
    name,
    from,
    to,
    data,
    value: '0x0',
    chainId: ens.chain.id,
    ...metadata,
    note: 'Unsigned transaction. Send it from the connected wallet; this API never stores a key or broadcasts.',
  }
}

export function recordPlan({ name, issuer, kind = 'freelance', employer, role, client }) {
  if (!normalizeName(name)) throw fail('name must be a valid ENS name.')
  if (!issuer || !isAddress(issuer)) throw fail('issuer must be the wallet that will issue invoices under this name.')
  if (!config.registry) throw fail('Hisaab registry is not configured on this server.', 503)
  const records = [
    { key: 'hisaab.registry', value: `${config.wcChainId}:${config.registry}` },
    { key: 'hisaab.wallet', value: issuer },
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
      const data = encodeFunctionData({ abi: resolverAbi, functionName: 'setData', args: [toHex(packetToBytes(n)), r.key, stringToHex(r.value)] })
      out.push(tx('set-name-data', n, from, resolver, data, { key: r.key, recordValue: r.value }))
    }
  }
  return { name: n, via: isSubname ? '/api/v1/ens/subchildren/set-data' : 'direct setData', transactions: out }
}

export async function prepareClientApprovalRole({ name, from, client }) {
  const n = normalizeName(name)
  if (!n) throw fail('name must be a valid ENS name.')
  if (!isAddress(from) || !isAddress(client)) throw fail('from and client must be addresses.')
  const resolver = await resolverFor(n)
  const resource = BigInt(keccak256(stringToHex('hisaab.approved')))
  const data = encodeFunctionData({ abi: resolverAbi, functionName: 'grantRoles', args: [resource, ROLE_SET_DATA, client] })
  return tx('grant-client-approval', n, from, resolver, data, { client, key: 'hisaab.approved' })
}

export async function prepareApproval({ name, from, invoiceId }) {
  const n = normalizeName(name)
  if (!n) throw fail('name must be a valid ENS name.')
  if (!isAddress(from)) throw fail('from must be the client wallet.')
  if (!/^\d+$/.test(String(invoiceId ?? ''))) throw fail('invoiceId must be an integer.')
  const info = await readName(n, ['hisaab.approved'])
  if (!info.resolver) throw fail(`${n} has no resolver.`, 409)
  const existing = (info.records['hisaab.approved'] || '').split(',').map((s) => s.trim()).filter(Boolean)
  const entry = `invoice:${invoiceId}`
  const value = existing.includes(entry) ? existing.join(',') : [...existing, entry].join(',')
  const data = encodeFunctionData({ abi: resolverAbi, functionName: 'setData', args: [toHex(packetToBytes(n)), 'hisaab.approved', stringToHex(value)] })
  return tx('client-approve-invoice', n, from, info.resolver, data, { key: 'hisaab.approved', recordValue: value })
}
