import { createServer } from 'node:http'
import { createPublicClient, encodeFunctionData, http, isAddress, keccak256, toHex, zeroAddress } from 'viem'
import { normalize } from 'viem/ens'
import { getNetwork, getRpcUrl } from './network.mjs'

const network = getNetwork(process.env.VITE_NETWORK)
const ETH_REGISTRAR = network.registrar
const ETH_REGISTRY = network.registry
const port = Number(process.env.PORT || 3000)
const client = createPublicClient({ chain: network.chain, transport: http(getRpcUrl(network, process.env)) })

// ENSv2 Enhanced Access Control role bits used by the parent-controlled policy.
const ROLE_REGISTRAR = 1n << 0n
const ROLE_UNREGISTER = 1n << 12n
const ROLE_RENEW = 1n << 16n
const ROLE_SET_RESOLVER = 1n << 24n

const registryReadAbi = [
  { type: 'function', name: 'getSubregistry', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'findOwner', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'hasRootRoles', stateMutability: 'view', inputs: [{ name: 'roleBitmap', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getStatus', stateMutability: 'view', inputs: [{ name: 'anyId', type: 'uint256' }], outputs: [{ type: 'uint8' }] },
]
const registryWriteAbi = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [
    { name: 'label', type: 'string' }, { name: 'owner', type: 'address' }, { name: 'registry', type: 'address' },
    { name: 'resolver', type: 'address' }, { name: 'roleBitmap', type: 'uint64' }, { name: 'expiry', type: 'uint64' },
  ], outputs: [{ name: 'tokenId', type: 'uint256' }] },
  { type: 'function', name: 'setResolver', stateMutability: 'nonpayable', inputs: [{ name: 'anyId', type: 'uint256' }, { name: 'resolver', type: 'address' }], outputs: [] },
  { type: 'function', name: 'renew', stateMutability: 'nonpayable', inputs: [{ name: 'anyId', type: 'uint256' }, { name: 'newExpiry', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'unregister', stateMutability: 'nonpayable', inputs: [{ name: 'anyId', type: 'uint256' }], outputs: [] },
]
const registrarAbi = [{ type: 'function', name: 'isAvailable', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'bool' }] }]

function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(status === 204 ? '' : JSON.stringify(body))
}
function fail(message, status = 400) { return Object.assign(new Error(message), { status }) }
function labelId(label) { return BigInt(keccak256(toHex(label))) }
function unsignedTransaction({ action, name, parent, from, to, data, expiry }) {
  return {
    action, name, parent, from, to, data, value: '0x0', chainId: network.chain.id,
    ...(expiry ? { expiry: expiry.toString() } : {}),
    note: 'Unsigned transaction. Send it from the connected parent wallet after reviewing it; this API never stores a key or broadcasts a transaction.',
  }
}
async function readBody(req) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > 16_384) throw fail('Request body too large.', 413)
  }
  try { return JSON.parse(text || '{}') } catch { throw fail('Body must be valid JSON.') }
}
function normalizedSubname(value) {
  let name
  try { name = normalize(String(value || '').trim()) } catch { throw fail('Invalid ENS name.') }
  const labels = name.split('.')
  if (labels.length < 3 || labels.at(-1) !== 'eth') throw fail('Provide a subname such as team.iownthis.eth.')
  return { name, labels, childLabel: labels[0], parentName: labels.slice(1).join('.') }
}
function expiryFrom(body) {
  let expiry
  try { expiry = BigInt(body.expiry || (Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)) } catch { throw fail('Expiry must be a Unix timestamp.') }
  if (expiry <= BigInt(Math.floor(Date.now() / 1000)) || expiry > 18446744073709551615n) throw fail('Expiry must be a future Unix timestamp that fits uint64.')
  return expiry
}

// Finds the registry that holds a child. The active owner of root.eth is the
// sole controller for all names below it, regardless of hierarchy depth.
async function resolveControlledChild(name, from) {
  if (!isAddress(from)) throw fail('Provide the connected parent wallet as from.')
  const { labels, childLabel, parentName } = normalizedSubname(name)
  const path = labels.slice(1, -1).reverse() // child.team.root.eth -> root, team
  const rootLabel = path[0]
  const rootOwner = await client.readContract({ address: ETH_REGISTRY, abi: registryReadAbi, functionName: 'findOwner', args: [rootLabel] })
  if (rootOwner === zeroAddress || rootOwner.toLowerCase() !== from.toLowerCase()) {
    throw fail(`Only the active owner of ${rootLabel}.eth can manage this hierarchy.`, 403)
  }

  let registry = ETH_REGISTRY
  for (const label of path) {
    const next = await client.readContract({ address: registry, abi: registryReadAbi, functionName: 'getSubregistry', args: [label] })
    if (next === zeroAddress) throw fail(`The parent path for ${name} has no child registry at ${label}.`, 409)
    registry = next
  }
  return { name, childLabel, parentName, rootName: `${rootLabel}.eth`, rootOwner, childRegistry: registry }
}
async function requireRootRole(registry, from, role) {
  const allowed = await client.readContract({ address: registry, abi: registryReadAbi, functionName: 'hasRootRoles', args: [role, from] })
  if (!allowed) throw fail('The parent wallet lacks the required registry administration permission.', 403)
}
async function hierarchyStatus(parent, from) {
  const scope = await resolveControlledChild(`placeholder.${parent}`, from)
  const permissions = await Promise.all([
    client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'hasRootRoles', args: [ROLE_REGISTRAR, from] }),
    client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'hasRootRoles', args: [ROLE_SET_RESOLVER, from] }),
    client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'hasRootRoles', args: [ROLE_RENEW, from] }),
    client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'hasRootRoles', args: [ROLE_UNREGISTER, from] }),
  ])
  return {
    parent: scope.parentName, rootParent: scope.rootName, controller: scope.rootOwner, childRegistry: scope.childRegistry,
    permissions: { create: permissions[0], modifyResolver: permissions[1], extendExpiry: permissions[2], revoke: permissions[3] },
    policy: 'Children are registered to the root parent wallet with a zero child permission bitmap.',
  }
}
async function prepareCreate(body) {
  const from = body.from
  const scope = await resolveControlledChild(body.name, from)
  await requireRootRole(scope.childRegistry, from, ROLE_REGISTRAR)
  const status = await client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'getStatus', args: [labelId(scope.childLabel)] })
  if (status !== 0) throw fail(`${scope.name} is ${status === 1 ? 'reserved' : 'already registered'}.`, 409)
  if (body.resolver && !isAddress(body.resolver)) throw fail('Resolver must be a valid address.')
  if (body.childRegistry && !isAddress(body.childRegistry)) throw fail('childRegistry must be a valid ENSv2 UserRegistry address.')
  const expiry = expiryFrom(body)
  // The root parent wallet owns every child; child owners are never supplied by callers.
  const data = encodeFunctionData({ abi: registryWriteAbi, functionName: 'register', args: [scope.childLabel, scope.rootOwner, body.childRegistry || zeroAddress, body.resolver || zeroAddress, 0n, expiry] })
  return unsignedTransaction({ action: 'create-child', name: scope.name, parent: scope.parentName, from, to: scope.childRegistry, data, expiry })
}
async function prepareModify(body) {
  const from = body.from
  const scope = await resolveControlledChild(body.name, from)
  const id = labelId(scope.childLabel)
  const status = await client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'getStatus', args: [id] })
  if (status !== 2) throw fail(`${scope.name} is not an active child name.`, 409)
  if (body.resolver) {
    if (!isAddress(body.resolver)) throw fail('Resolver must be a valid address.')
    await requireRootRole(scope.childRegistry, from, ROLE_SET_RESOLVER)
    const data = encodeFunctionData({ abi: registryWriteAbi, functionName: 'setResolver', args: [id, body.resolver] })
    return unsignedTransaction({ action: 'set-child-resolver', name: scope.name, parent: scope.parentName, from, to: scope.childRegistry, data })
  }
  if (body.expiry) {
    const expiry = expiryFrom(body)
    await requireRootRole(scope.childRegistry, from, ROLE_RENEW)
    const data = encodeFunctionData({ abi: registryWriteAbi, functionName: 'renew', args: [id, expiry] })
    return unsignedTransaction({ action: 'extend-child-expiry', name: scope.name, parent: scope.parentName, from, to: scope.childRegistry, data, expiry })
  }
  throw fail('Provide either resolver or expiry to modify a child.')
}
async function prepareRevoke(body) {
  const from = body.from
  const scope = await resolveControlledChild(body.name, from)
  const id = labelId(scope.childLabel)
  const status = await client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'getStatus', args: [id] })
  if (status !== 2) throw fail(`${scope.name} is not an active child name.`, 409)
  await requireRootRole(scope.childRegistry, from, ROLE_UNREGISTER)
  const data = encodeFunctionData({ abi: registryWriteAbi, functionName: 'unregister', args: [id] })
  return unsignedTransaction({ action: 'revoke-child', name: scope.name, parent: scope.parentName, from, to: scope.childRegistry, data })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (req.method === 'OPTIONS') return reply(res, 204, {})
  try {
    if (req.method === 'GET' && url.pathname === '/api/ens/availability') {
      if (!network.supportsTopLevelRegistration) throw fail(network.topLevelRegistrationMessage, 409)
      const raw = url.searchParams.get('name')
      if (!raw) throw fail('Missing required query parameter: name (example: myname.eth)')
      const name = normalize(raw.trim())
      const labels = name.split('.')
      if (labels.length !== 2 || labels[1] !== 'eth') throw fail('Provide a top-level .eth name, such as myname.eth.')
      const available = await client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'isAvailable', args: [labels[0]] })
      return reply(res, 200, { name, available, network: network.key })
    }
    if (req.method === 'GET' && url.pathname === '/api/ens/children/status') {
      const parent = url.searchParams.get('parent')
      const from = url.searchParams.get('from')
      if (!parent || !from) throw fail('Provide parent and from query parameters.')
      return reply(res, 200, await hierarchyStatus(normalize(parent), from))
    }
    if (req.method === 'POST' && url.pathname === '/api/ens/children/create') return reply(res, 200, await prepareCreate(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/ens/children/modify') return reply(res, 200, await prepareModify(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/ens/children/revoke') return reply(res, 200, await prepareRevoke(await readBody(req)))
    return reply(res, 404, { error: 'Use /api/ens/availability or /api/ens/children/{status,create,modify,revoke}.' })
  } catch (error) {
    console.error('ENS API failed:', error.shortMessage || error.message)
    return reply(res, error.status || 502, { error: error.shortMessage || error.message })
  }
})
server.listen(port, () => console.log(`ENS API listening at http://localhost:${port}`))
