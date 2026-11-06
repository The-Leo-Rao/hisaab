import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  keccak256,
  parseAbi,
  recoverMessageAddress,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { normalize, packetToBytes } from 'viem/ens'
import { getNetwork, getRpcUrl } from './network.mjs'
import { handleHisaab, isHisaabRoute } from './hisaab/routes.mjs'
import { config as hisaabConfig } from './hisaab/config.mjs'
import { wc as whitechainClient } from './hisaab/whitechain.mjs'

const network = getNetwork(process.env.VITE_NETWORK)
const port = Number(process.env.PORT || 3000)
const client = createPublicClient({
  chain: network.chain,
  transport: http(getRpcUrl(network, process.env)),
})

const ETH_REGISTRAR = network.registrar
const ETH_REGISTRY = network.registry
const PAYMENT_TOKEN = network.paymentToken
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000
const authChallenges = new Map()

// ENSv2 Enhanced Access Control role bits used by the parent-controlled policy.
const ROLE_REGISTRAR = 1n << 0n
const ROLE_UNREGISTER = 1n << 12n
const ROLE_RENEW = 1n << 16n
const ROLE_SET_RESOLVER = 1n << 24n
// Permissioned Resolver role for setData(name, key, value).
const ROLE_SET_DATA = 1n << 24n

const registryReadAbi = [
  { type: 'function', name: 'getSubregistry', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getResolver', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'findOwner', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'hasRootRoles', stateMutability: 'view', inputs: [{ name: 'roleBitmap', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getStatus', stateMutability: 'view', inputs: [{ name: 'anyId', type: 'uint256' }], outputs: [{ type: 'uint8' }] },
]

const registryEventAbi = parseAbi([
  'event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)',
  'event LabelReserved(uint256 indexed tokenId, bytes32 indexed labelHash, string label, uint64 expiry, address indexed sender)',
  'event TokenRegenerated(uint256 indexed oldTokenId, uint256 indexed newTokenId)',
  'event SubregistryUpdated(uint256 indexed tokenId, address indexed subregistry, address indexed sender)',
])

const resolverReadAbi = [
  { type: 'function', name: 'hasRootRoles', stateMutability: 'view', inputs: [{ name: 'roleBitmap', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'hasRoles', stateMutability: 'view', inputs: [{ name: 'anyId', type: 'uint256' }, { name: 'roleBitmap', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
]

const resolverWriteAbi = [
  { type: 'function', name: 'setData', stateMutability: 'nonpayable', inputs: [
    { name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'bytes' },
  ], outputs: [] },
]

const registryWriteAbi = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [
    { name: 'label', type: 'string' }, { name: 'owner', type: 'address' }, { name: 'registry', type: 'address' },
    { name: 'resolver', type: 'address' }, { name: 'roleBitmap', type: 'uint256' }, { name: 'expiry', type: 'uint64' },
  ], outputs: [{ name: 'tokenId', type: 'uint256' }] },
  { type: 'function', name: 'setResolver', stateMutability: 'nonpayable', inputs: [{ name: 'anyId', type: 'uint256' }, { name: 'resolver', type: 'address' }], outputs: [] },
  { type: 'function', name: 'renew', stateMutability: 'nonpayable', inputs: [{ name: 'anyId', type: 'uint256' }, { name: 'newExpiry', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'unregister', stateMutability: 'nonpayable', inputs: [{ name: 'anyId', type: 'uint256' }], outputs: [] },
]

const registrarAbi = parseAbi([
  'function isAvailable(string label) view returns (bool)',
  'function getRegisterPrice(string label,uint64 duration,address paymentToken) view returns (uint256 base,uint256 premium)',
  'function makeCommitment(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,bytes32 referrer) pure returns (bytes32)',
  'function commit(bytes32 commitment)',
  'function commitmentAt(bytes32 commitment) view returns (uint64)',
  'function MIN_COMMITMENT_AGE() view returns (uint64)',
  'function MIN_REGISTER_DURATION() view returns (uint64)',
  'function register(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 referrer) returns (uint256 tokenId)',
])

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(status === 204 ? '' : JSON.stringify(body))
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

async function readBody(req) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > 16_384) throw fail('Request body too large.', 413)
  }
  try { return JSON.parse(text || '{}') } catch { throw fail('Body must be valid JSON.') }
}

function unsignedTransaction({ action, name, parent, from, to, data, value = 0n, chainId = network.chain.id, metadata = {} }) {
  const txValue = `0x${value.toString(16)}`
  return {
    action,
    name,
    parent,
    from,
    to,
    data,
    chainId,
    ...metadata,
    value: txValue,
    metadata,
    note: 'Unsigned transaction. Send it from the connected wallet after reviewing it; this API never stores a key or broadcasts a transaction.',
  }
}

// Frontend wallet submission helper: only the fields a wallet should sign.
export function walletSubmitFields(tx) {
  return {
    to: tx.to,
    data: tx.data,
    value: tx.value,
    chainId: tx.chainId,
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function parseAddress(value, field) {
  if (!value || !isAddress(value)) throw fail(`${field} must be a valid Ethereum address.`)
  return value
}

function parseHex32(value, field) {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw fail(`${field} must be a 32-byte hex string (0x...).`)
  return value
}

function parseOptionalHex32(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  return parseHex32(value, field)
}

function parseDuration(value) {
  if (!value) return 31536000n // 1 year default
  try {
    const d = BigInt(value)
    if (d <= 0n) throw fail('Duration must be a positive integer (seconds).')
    return d
  } catch {
    throw fail('Duration must be a positive integer (seconds).')
  }
}

function parseExpiry(body) {
  let expiry
  try { expiry = BigInt(body.expiry || (Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)) } catch { throw fail('Expiry must be a Unix timestamp.') }
  if (expiry <= BigInt(Math.floor(Date.now() / 1000)) || expiry > 18446744073709551615n) throw fail('Expiry must be a future Unix timestamp that fits uint64.')
  return expiry
}

function parseTopLevelName(raw) {
  if (!raw) throw fail('Missing required parameter: name (example: myname.eth)')
  let name
  try { name = normalize(String(raw).trim()) } catch { throw fail('Invalid ENS name.') }
  const labels = name.split('.')
  if (labels.length !== 2 || labels[1] !== 'eth') throw fail('Provide a top-level .eth name, such as myname.eth.')
  return { name, label: labels[0] }
}

function normalizedSubname(value) {
  let name
  try { name = normalize(String(value || '').trim()) } catch { throw fail('Invalid ENS name.') }
  const labels = name.split('.')
  if (labels.length < 3 || labels.at(-1) !== 'eth') throw fail('Provide a subname such as team.iownthis.eth.')
  return { name, labels, childLabel: labels[0], parentName: labels.slice(1).join('.') }
}

function normalizedParentName(value) {
  let name
  try { name = normalize(String(value || '').trim()) } catch { throw fail('Invalid ENS parent name.') }
  const labels = name.split('.')
  if (labels.length < 2 || labels.at(-1) !== 'eth') throw fail('Provide an ENSv2 .eth parent name, such as team.iownthis.eth.')
  return name
}

function childNameFromParent(parentInput, labelInput) {
  const parent = normalizedParentName(parentInput)
  let candidate
  try { candidate = normalize(`${String(labelInput || '').trim()}.eth`) } catch { throw fail('Invalid subchild label.') }
  const labels = candidate.split('.')
  if (labels.length !== 2 || labels[1] !== 'eth') throw fail('label must be one ENS label, without dots.')
  return { parent, label: labels[0], name: normalize(`${labels[0]}.${parent}`) }
}

function parseDataRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw fail('data must be an object with key, value, and optional encoding.')
  const key = typeof record.key === 'string' ? record.key.trim() : ''
  if (!key) throw fail('data.key must be a non-empty string.')
  if (key.length > 256) throw fail('data.key must be at most 256 characters.')
  const encoding = record.encoding || 'utf8'
  if (encoding !== 'utf8' && encoding !== 'hex') throw fail('data.encoding must be either "utf8" or "hex".')
  if (typeof record.value !== 'string') throw fail('data.value must be a string.')
  if (encoding === 'hex') {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(record.value)) throw fail('Hex data.value must have an 0x prefix and an even number of hex characters.')
    return { key, value: record.value, encoding }
  }
  return { key, value: stringToHex(record.value), encoding }
}

function labelId(label) {
  return BigInt(keccak256(toHex(label)))
}

function parseBlockNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (!/^(0|[1-9]\d*)$/.test(value)) throw fail('fromBlock must be a non-negative block number.')
  return BigInt(value)
}

const LOG_RANGE = BigInt(process.env.ENS_LOG_RANGE || 50000)
const LOG_LOOKBACK = BigInt(process.env.ENS_LOG_LOOKBACK || 9000)

async function getLogsChunked(params) {
  const logs = []
  for (let start = params.fromBlock; start <= params.toBlock; start += LOG_RANGE) {
    const end = start + LOG_RANGE - 1n < params.toBlock ? start + LOG_RANGE - 1n : params.toBlock
    try {
      logs.push(...(await client.getLogs({ ...params, fromBlock: start, toBlock: end })))
    } catch (error) {
      throw fail(`The RPC could not return logs for blocks ${start}-${end} (${error.shortMessage || error.message}). Public RPCs prune old logs; pass a recent fromBlock or set an archive VITE_SEPOLIA_RPC_URL.`, 502)
    }
  }
  return logs
}

function registryStatus(status) {
  return ['available', 'reserved', 'registered'][Number(status)] || 'unknown'
}

async function currentEnsOwner(name) {
  const normalized = normalize(String(name).trim())
  const labels = normalized.split('.')
  if (labels.length < 2 || labels.at(-1) !== 'eth') throw fail('Provide an ENSv2 .eth name, such as myname.eth.')

  let parentLabel = labels.at(-2)
  let registry = ETH_REGISTRY
  let owner = await client.readContract({ address: registry, abi: registryReadAbi, functionName: 'findOwner', args: [parentLabel] })
  if (owner === zeroAddress) return owner

  for (const label of labels.slice(0, -2).reverse()) {
    registry = await client.readContract({ address: registry, abi: registryReadAbi, functionName: 'getSubregistry', args: [parentLabel] })
    if (registry === zeroAddress) return zeroAddress
    owner = await client.readContract({ address: registry, abi: registryReadAbi, functionName: 'findOwner', args: [label] })
    if (owner === zeroAddress) return owner
    parentLabel = label
  }
  return owner
}

// Resolve a name to the registry and label that own its subregistry pointer.
// For example, team.iownthis.eth is the "team" entry in iownthis.eth's registry.
async function resolveRegistryEntry(nameInput) {
  const name = normalizedParentName(nameInput)
  const labels = name.split('.')
  let registry = ETH_REGISTRY

  for (const label of labels.slice(1, -1).reverse()) {
    const next = await client.readContract({ address: registry, abi: registryReadAbi, functionName: 'getSubregistry', args: [label] })
    if (next === zeroAddress) throw fail(`The parent path for ${name} has no child registry at ${label}.`, 409)
    registry = next
  }
  return { name, label: labels[0], registry }
}

async function listParentSubregistries(parentInput, fromBlockInput) {
  const scope = await resolveRegistryEntry(parentInput)
  const resource = labelId(scope.label)
  const labelHash = keccak256(toHex(scope.label))
  const toBlock = await client.getBlockNumber()
  const requested = parseBlockNumber(fromBlockInput) ?? (process.env.ENS_FROM_BLOCK ? BigInt(process.env.ENS_FROM_BLOCK) : null)
  const fromBlock = requested ?? (toBlock > LOG_LOOKBACK ? toBlock - LOG_LOOKBACK : 0n)
  if (fromBlock > toBlock) throw fail('fromBlock cannot be greater than the latest block.')

  // Label events seed every registration lifecycle for this label. Token IDs
  // can subsequently change when roles change, so TokenRegenerated completes
  // the lineage before querying SubregistryUpdated by token ID. We do not rely
  // on getTokenId because the advanced ABI correction removed it; the latest
  // lifecycle event is the safest seed for the current token ID.
  const [status, currentSubregistry, registrationLogs, reservationLogs] = await Promise.all([
    client.readContract({ address: scope.registry, abi: registryReadAbi, functionName: 'getStatus', args: [resource] }),
    client.readContract({ address: scope.registry, abi: registryReadAbi, functionName: 'getSubregistry', args: [scope.label] }),
    getLogsChunked({
      address: scope.registry,
      event: registryEventAbi[0],
      args: { labelHash },
      fromBlock,
      toBlock,
    }),
    getLogsChunked({
      address: scope.registry,
      event: registryEventAbi[1],
      args: { labelHash },
      fromBlock,
      toBlock,
    }),
  ])
  const tokenIds = new Set([...registrationLogs, ...reservationLogs].map(log => log.args.tokenId).filter(id => id !== undefined && id !== 0n))
  const sortedLifecycle = [...registrationLogs, ...reservationLogs].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
    return left.logIndex < right.logIndex ? -1 : left.logIndex > right.logIndex ? 1 : 0
  })
  const latestTokenId = sortedLifecycle.at(-1)?.args.tokenId
  if (latestTokenId && latestTokenId !== 0n) tokenIds.add(latestTokenId)

  const uncheckedTokenIds = [...tokenIds]
  const checkedTokenIds = new Set()
  while (uncheckedTokenIds.length > 0) {
    const tokenId = uncheckedTokenIds.pop()
    if (checkedTokenIds.has(tokenId)) continue
    checkedTokenIds.add(tokenId)
    const [forward, backward] = await Promise.all([
      getLogsChunked({ address: scope.registry, event: registryEventAbi[2], args: { oldTokenId: tokenId }, fromBlock, toBlock }),
      getLogsChunked({ address: scope.registry, event: registryEventAbi[2], args: { newTokenId: tokenId }, fromBlock, toBlock }),
    ])
    for (const log of forward) {
      const next = log.args.newTokenId
      if (!tokenIds.has(next)) {
        tokenIds.add(next)
        uncheckedTokenIds.push(next)
      }
    }
    for (const log of backward) {
      const previous = log.args.oldTokenId
      if (!tokenIds.has(previous)) {
        tokenIds.add(previous)
        uncheckedTokenIds.push(previous)
      }
    }
  }

  const updates = (await Promise.all([...tokenIds].map(tokenId => getLogsChunked({
    address: scope.registry,
    event: registryEventAbi[3],
    args: { tokenId },
    fromBlock,
    toBlock,
  })))).flat().sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
    return left.logIndex < right.logIndex ? -1 : left.logIndex > right.logIndex ? 1 : 0
  })

  const history = updates.map(log => ({
    tokenId: log.args.tokenId.toString(),
    subregistry: log.args.subregistry,
    sender: log.args.sender,
    blockNumber: log.blockNumber.toString(),
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  }))
  const subregistries = new Map()
  for (const update of history) {
    // A zero-address update detaches the current subregistry and is retained
    // in history, but it is not itself a subregistry contract.
    if (update.subregistry === zeroAddress) continue
    const key = update.subregistry.toLowerCase()
    const item = subregistries.get(key) || {
      address: update.subregistry,
      firstUpdatedAt: { blockNumber: update.blockNumber, transactionHash: update.transactionHash, logIndex: update.logIndex },
      lastUpdatedAt: undefined,
      updateCount: 0,
      currentlyAttached: update.subregistry.toLowerCase() === currentSubregistry.toLowerCase(),
    }
    item.lastUpdatedAt = { blockNumber: update.blockNumber, transactionHash: update.transactionHash, logIndex: update.logIndex }
    item.updateCount += 1
    subregistries.set(key, item)
  }

  return {
    parent: scope.name,
    registry: scope.registry,
    label: scope.label,
    status: registryStatus(status),
    currentSubregistry: currentSubregistry === zeroAddress ? null : currentSubregistry,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    subregistries: [...subregistries.values()],
    history,
  }
}

// ---------------------------------------------------------------------------
// ENSv2 subname (parent-controlled) helpers
// ---------------------------------------------------------------------------

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
    parent: scope.parentName,
    rootParent: scope.rootName,
    controller: scope.rootOwner,
    childRegistry: scope.childRegistry,
    permissions: { create: permissions[0], modifyResolver: permissions[1], extendExpiry: permissions[2], revoke: permissions[3] },
    policy: 'Children are registered to the root parent wallet with a zero child permission bitmap.',
  }
}

async function prepareCreate(body) {
  const from = parseAddress(body.from, 'from')
  const scope = await resolveControlledChild(body.name, from)
  await requireRootRole(scope.childRegistry, from, ROLE_REGISTRAR)
  const status = await client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'getStatus', args: [labelId(scope.childLabel)] })
  if (status !== 0) throw fail(`${scope.name} is ${status === 1 ? 'reserved' : 'already registered'}.`, 409)
  if (body.resolver && !isAddress(body.resolver)) throw fail('Resolver must be a valid address.')
  if (body.childRegistry && !isAddress(body.childRegistry)) throw fail('childRegistry must be a valid ENSv2 UserRegistry address.')
  const expiry = parseExpiry(body)
  const data = encodeFunctionData({
    abi: registryWriteAbi,
    functionName: 'register',
    args: [scope.childLabel, scope.rootOwner, body.childRegistry || zeroAddress, body.resolver || zeroAddress, 0n, expiry],
  })
  return unsignedTransaction({ action: 'create-child', name: scope.name, parent: scope.parentName, from, to: scope.childRegistry, data, metadata: { expiry: expiry.toString() } })
}

async function prepareModify(body) {
  const from = parseAddress(body.from, 'from')
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
    const expiry = parseExpiry(body)
    await requireRootRole(scope.childRegistry, from, ROLE_RENEW)
    const data = encodeFunctionData({ abi: registryWriteAbi, functionName: 'renew', args: [id, expiry] })
    return unsignedTransaction({ action: 'extend-child-expiry', name: scope.name, parent: scope.parentName, from, to: scope.childRegistry, data, metadata: { expiry: expiry.toString() } })
  }
  throw fail('Provide either resolver or expiry to modify a child.')
}

async function prepareRevoke(body) {
  const from = parseAddress(body.from, 'from')
  const scope = await resolveControlledChild(body.name, from)
  const id = labelId(scope.childLabel)
  const status = await client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'getStatus', args: [id] })
  if (status !== 2) throw fail(`${scope.name} is not an active child name.`, 409)
  await requireRootRole(scope.childRegistry, from, ROLE_UNREGISTER)
  const data = encodeFunctionData({ abi: registryWriteAbi, functionName: 'unregister', args: [id] })
  return unsignedTransaction({ action: 'revoke-child', name: scope.name, parent: scope.parentName, from, to: scope.childRegistry, data })
}

async function prepareDataWrite({ name, parent, from, resolver, dataRecord }) {
  const resource = labelId(dataRecord.key)
  const [hasRootPermission, hasKeyPermission] = await Promise.all([
    client.readContract({ address: resolver, abi: resolverReadAbi, functionName: 'hasRootRoles', args: [ROLE_SET_DATA, from] }),
    client.readContract({ address: resolver, abi: resolverReadAbi, functionName: 'hasRoles', args: [resource, ROLE_SET_DATA, from] }),
  ])
  if (!hasRootPermission && !hasKeyPermission) {
    throw fail(`The connected wallet lacks Permissioned Resolver permission to set data key "${dataRecord.key}".`, 403)
  }
  const data = encodeFunctionData({
    abi: resolverWriteAbi,
    functionName: 'setData',
    args: [toHex(packetToBytes(name)), dataRecord.key, dataRecord.value],
  })
  return unsignedTransaction({
    action: 'set-subchild-data',
    name,
    parent,
    from,
    to: resolver,
    data,
    metadata: {
      key: dataRecord.key,
      encodedValue: dataRecord.value,
      value: dataRecord.value, // legacy compatibility field
      encoding: dataRecord.encoding,
      permission: hasRootPermission ? 'resolver-root-role' : 'data-key-role',
    },
  })
}

// register() and setData() target different contracts, so a data record is
// returned as a second wallet transaction rather than pretending it is atomic.
async function prepareSubchildRegistration(body) {
  const { parent, name } = childNameFromParent(body.parent, body.label)
  const registration = await prepareCreate({ ...body, name })
  if (body.data === undefined) return { registration }

  if (!body.resolver || !isAddress(body.resolver)) {
    throw fail('resolver must be a valid Permissioned Resolver address when data is supplied.')
  }
  const dataWrite = await prepareDataWrite({
    name,
    parent,
    from: registration.from,
    resolver: body.resolver,
    dataRecord: parseDataRecord(body.data),
  })
  return {
    registration,
    dataWrite,
    sequence: ['Send registration first.', 'After it confirms, send dataWrite to store the resolver record.'],
  }
}

async function prepareExistingSubchildData(body) {
  const from = parseAddress(body.from, 'from')
  const scope = await resolveControlledChild(body.name, from)
  const status = await client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'getStatus', args: [labelId(scope.childLabel)] })
  if (status !== 2) throw fail(`${scope.name} is not an active child name.`, 409)
  const resolver = await client.readContract({ address: scope.childRegistry, abi: registryReadAbi, functionName: 'getResolver', args: [scope.childLabel] })
  if (resolver === zeroAddress) throw fail(`${scope.name} has no resolver. Set one before writing data.`, 409)
  return prepareDataWrite({ name: scope.name, parent: scope.parentName, from, resolver, dataRecord: parseDataRecord(body.data) })
}

// These wrappers keep the subchild API explicit while reusing the same
// authorization and active-name checks as the hierarchy-wide operations.
async function prepareSubchildUnregistration(body) {
  return prepareRevoke(body)
}

async function prepareSubchildDataUpdate(body) {
  return prepareExistingSubchildData(body)
}

// ---------------------------------------------------------------------------
// ENSv2 top-level .eth registration helpers
// ---------------------------------------------------------------------------

function assertTopLevelRegistration() {
  if (!network.supportsTopLevelRegistration) throw fail(network.topLevelRegistrationMessage, 409)
}

async function getRegisterQuote(name, owner, duration) {
  assertTopLevelRegistration()
  const { label } = parseTopLevelName(name)
  parseAddress(owner, 'owner')
  const dur = parseDuration(duration)
  const [available, [base, premium], minDuration, minCommitmentAge] = await Promise.all([
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'isAvailable', args: [label] }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'getRegisterPrice', args: [label, dur, PAYMENT_TOKEN] }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'MIN_REGISTER_DURATION' }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'MIN_COMMITMENT_AGE' }),
  ])
  return {
    name,
    label,
    owner,
    duration: dur.toString(),
    available,
    base: base.toString(),
    premium: premium.toString(),
    total: (base + premium).toString(),
    paymentToken: PAYMENT_TOKEN,
    minDuration: minDuration.toString(),
    minCommitmentAge: minCommitmentAge.toString(),
    network: network.key,
  }
}

async function prepareCommit(body) {
  assertTopLevelRegistration()
  const { name, label } = parseTopLevelName(body.name)
  const owner = parseAddress(body.owner, 'owner')
  const from = parseAddress(body.from, 'from')
  if (owner.toLowerCase() !== from.toLowerCase()) throw fail('owner must match from (the connected wallet).', 403)
  const duration = parseDuration(body.duration)
  const secret = parseOptionalHex32(body.secret, 'secret') || keccak256(toHex(randomBytes(32)))
  const subregistry = body.subregistry && isAddress(body.subregistry) ? body.subregistry : zeroAddress
  const resolver = body.resolver && isAddress(body.resolver) ? body.resolver : zeroAddress
  const referrer = parseOptionalHex32(body.referrer, 'referrer') || zeroHash

  const [available, minDuration, commitment] = await Promise.all([
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'isAvailable', args: [label] }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'MIN_REGISTER_DURATION' }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'makeCommitment', args: [label, owner, secret, subregistry, resolver, duration, referrer] }),
  ])
  if (!available) throw fail(`${name} is not available.`, 409)
  if (duration < minDuration) throw fail(`Duration ${duration} is below ENS minimum of ${minDuration} seconds.`, 400)

  const data = encodeFunctionData({ abi: registrarAbi, functionName: 'commit', args: [commitment] })
  return unsignedTransaction({
    action: 'ens-register-commit',
    name,
    from,
    to: ETH_REGISTRAR,
    data,
    metadata: {
      owner,
      secret,
      commitment,
      subregistry,
      resolver,
      duration: duration.toString(),
      referrer,
    },
  })
}

async function getCommitmentStatus(commitment) {
  assertTopLevelRegistration()
  const hash = parseHex32(commitment, 'commitment')
  const [committedAt, minCommitmentAge] = await Promise.all([
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'commitmentAt', args: [hash] }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'MIN_COMMITMENT_AGE' }),
  ])
  const now = BigInt(Math.floor(Date.now() / 1000))
  const age = committedAt > 0n ? now - committedAt : 0n
  const remaining = age >= minCommitmentAge ? 0n : minCommitmentAge - age
  return {
    commitment: hash,
    committedAt: committedAt.toString(),
    minCommitmentAge: minCommitmentAge.toString(),
    age: age.toString(),
    remainingSeconds: remaining.toString(),
    canReveal: remaining === 0n && committedAt > 0n,
  }
}

async function prepareReveal(body) {
  assertTopLevelRegistration()
  const { name, label } = parseTopLevelName(body.name)
  const owner = parseAddress(body.owner, 'owner')
  const from = parseAddress(body.from, 'from')
  if (owner.toLowerCase() !== from.toLowerCase()) throw fail('owner must match from (the connected wallet).', 403)
  const duration = parseDuration(body.duration)
  const secret = parseHex32(body.secret, 'secret')
  const subregistry = body.subregistry && isAddress(body.subregistry) ? body.subregistry : zeroAddress
  const resolver = body.resolver && isAddress(body.resolver) ? body.resolver : zeroAddress
  const referrer = parseOptionalHex32(body.referrer, 'referrer') || zeroHash

  const commitment = await client.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: 'makeCommitment',
    args: [label, owner, secret, subregistry, resolver, duration, referrer],
  })

  const [available, [base, premium], minDuration, minCommitmentAge, committedAt] = await Promise.all([
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'isAvailable', args: [label] }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'getRegisterPrice', args: [label, duration, PAYMENT_TOKEN] }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'MIN_REGISTER_DURATION' }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'MIN_COMMITMENT_AGE' }),
    client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'commitmentAt', args: [commitment] }),
  ])

  if (!available) throw fail(`${name} is no longer available.`, 409)
  if (duration < minDuration) throw fail(`Duration ${duration} is below ENS minimum of ${minDuration} seconds.`, 400)
  if (committedAt === 0n) throw fail('Commitment not found. Submit the commit transaction first.', 409)
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (now - committedAt < minCommitmentAge) throw fail('Commitment is not old enough to reveal yet.', 425)

  const total = base + premium
  const data = encodeFunctionData({
    abi: registrarAbi,
    functionName: 'register',
    args: [label, owner, secret, subregistry, resolver, duration, PAYMENT_TOKEN, referrer],
  })
  return unsignedTransaction({
    action: 'ens-register-reveal',
    name,
    from,
    to: ETH_REGISTRAR,
    data,
    metadata: {
      owner,
      secret,
      commitment,
      subregistry,
      resolver,
      duration: duration.toString(),
      referrer,
      paymentToken: PAYMENT_TOKEN,
      total: total.toString(),
    },
  })
}

function createAuthChallenge(nameInput, addressInput) {
  let name
  try { name = normalize(String(nameInput || '').trim()) } catch { throw fail('Provide a valid ENS name.') }
  if (!name.endsWith('.eth')) throw fail('Provide an ENSv2 .eth name, such as myname.eth.')
  const address = parseAddress(addressInput, 'address')
  const now = Date.now()
  for (const [id, challenge] of authChallenges) {
    if (challenge.expiresAt <= now) authChallenges.delete(id)
  }
  const challengeId = `0x${randomBytes(16).toString('hex')}`
  const nonce = `0x${randomBytes(32).toString('hex')}`
  const expiresAt = now + AUTH_CHALLENGE_TTL_MS
  const issuedAt = new Date(now).toISOString()
  const expirationTime = new Date(expiresAt).toISOString()
  const message = [
    'Sign in to Hisaab ENSv2',
    '',
    `ENS name: ${name}`,
    `Wallet: ${address}`,
    `Chain ID: ${network.chain.id}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
    `Expiration time: ${expirationTime}`,
  ].join('\n')
  authChallenges.set(challengeId, { name, address, message, expiresAt })
  return { challengeId, message, expiresAt: expirationTime }
}

async function verifyAuthChallenge(body) {
  const challengeId = String(body.challengeId || '')
  const signature = String(body.signature || '')
  if (!/^0x[0-9a-fA-F]{32}$/.test(challengeId)) throw fail('challengeId must be a 16-byte hex value.')
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw fail('signature must be a 65-byte hex value.')
  const challenge = authChallenges.get(challengeId)
  if (!challenge) throw fail('Challenge not found or already used.', 409)
  authChallenges.delete(challengeId)
  if (challenge.expiresAt <= Date.now()) throw fail('Challenge expired. Request a new challenge.', 410)

  let recoveredAddress
  try { recoveredAddress = await recoverMessageAddress({ message: challenge.message, signature }) } catch { throw fail('Signature is invalid.') }
  if (recoveredAddress.toLowerCase() !== challenge.address.toLowerCase()) throw fail('Signature does not match the challenged wallet.', 403)

  const owner = await currentEnsOwner(challenge.name)
  const verified = owner !== zeroAddress && owner.toLowerCase() === challenge.address.toLowerCase()
  return {
    verified,
    name: challenge.name,
    address: challenge.address,
    owner,
    network: network.key,
    chainId: network.chain.id,
  }
}

// ---------------------------------------------------------------------------
// Startup configuration checks
// ---------------------------------------------------------------------------

async function startupChecks() {
  const checks = []
  try {
    const block = await client.getBlockNumber()
    checks.push({ name: 'ENS/Sepolia', ok: true, chainId: network.chain.id, block: block.toString() })
  } catch (error) {
    checks.push({ name: 'ENS/Sepolia', ok: false, error: error.shortMessage || error.message })
  }

  if (hisaabConfig.registry && hisaabConfig.receipt) {
    try {
      const block = await whitechainClient.getBlockNumber()
      checks.push({ name: 'Whitechain', ok: true, chainId: hisaabConfig.wcChainId, block: block.toString() })
    } catch (error) {
      checks.push({ name: 'Whitechain', ok: false, error: error.shortMessage || error.message })
    }
  } else {
    checks.push({ name: 'Whitechain', ok: false, error: 'Hisaab contracts not configured (set HISAAB_REGISTRY and HISAAB_RECEIPT).' })
  }

  console.log('Startup configuration status:')
  for (const check of checks) {
    const status = check.ok ? 'OK' : 'FAIL'
    const detail = check.block ? ` (block ${check.block})` : ''
    const err = check.error ? `: ${check.error}` : ''
    console.log(`  ${status} ${check.name}${detail}${err}`)
  }
  return checks
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (req.method === 'OPTIONS') return reply(res, 204, {})

  try {
    // Hisaab routes are checked FIRST, before the ENS fallback.
    if (isHisaabRoute(url.pathname) && (await handleHisaab(req, res, url)) !== false) return

    // Status / connection check
    if (req.method === 'GET' && url.pathname === '/api/v1/ens/status') {
      return reply(res, 200, {
        network: network.key,
        chainId: network.chain.id,
        displayName: network.displayName,
        registrar: ETH_REGISTRAR,
        registry: ETH_REGISTRY,
        paymentToken: PAYMENT_TOKEN,
        supportsTopLevelRegistration: network.supportsTopLevelRegistration,
      })
    }

    // Top-level .eth availability
    if (req.method === 'GET' && url.pathname === '/api/v1/ens/availability') {
      assertTopLevelRegistration()
      const { name, label } = parseTopLevelName(url.searchParams.get('name'))
      const available = await client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'isAvailable', args: [label] })
      return reply(res, 200, { name, available, network: network.key })
    }

    // Top-level registration quote
    if (req.method === 'GET' && url.pathname === '/api/v1/ens/register/quote') {
      const name = url.searchParams.get('name')
      const owner = url.searchParams.get('owner')
      const duration = url.searchParams.get('duration')
      return reply(res, 200, await getRegisterQuote(name, owner, duration))
    }

    // Prepare commit transaction
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/register/prepare-commit') {
      return reply(res, 200, await prepareCommit(await readBody(req)))
    }

    // Commitment status / reveal countdown
    if (req.method === 'GET' && url.pathname === '/api/v1/ens/register/commitment-status') {
      const commitment = url.searchParams.get('commitment')
      return reply(res, 200, await getCommitmentStatus(commitment))
    }

    // Prepare reveal/register transaction
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/register/prepare-reveal') {
      return reply(res, 200, await prepareReveal(await readBody(req)))
    }

    // ENS wallet ownership sign-in challenge
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/auth/challenge') {
      const body = await readBody(req)
      return reply(res, 200, createAuthChallenge(body.name, body.address))
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/auth/verify') {
      return reply(res, 200, await verifyAuthChallenge(await readBody(req)))
    }

    // Parent-controlled subname hierarchy status
    if (req.method === 'GET' && url.pathname === '/api/v1/ens/children/status') {
      const parent = url.searchParams.get('parent')
      const from = url.searchParams.get('from')
      if (!parent || !from) throw fail('Provide parent and from query parameters.')
      return reply(res, 200, await hierarchyStatus(normalize(parent), from))
    }

    // Historical and current subregistry attachments for one ENSv2 name.
    if (req.method === 'GET' && url.pathname === '/api/v1/ens/subregistries') {
      const parent = url.searchParams.get('parent')
      if (!parent) throw fail('Provide a parent query parameter.')
      return reply(res, 200, await listParentSubregistries(parent, url.searchParams.get('fromBlock')))
    }

    // Subname create / modify / revoke
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/children/create') return reply(res, 200, await prepareCreate(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/children/modify') return reply(res, 200, await prepareModify(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/children/revoke') return reply(res, 200, await prepareRevoke(await readBody(req)))

    // Subchild registration and Permissioned Resolver data records.
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/subchildren/register') return reply(res, 200, await prepareSubchildRegistration(await readBody(req)))
    // Legacy aliases retained for base-style frontends.
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/subchildren/unregister') return reply(res, 200, await prepareSubchildUnregistration(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/subchildren/update-data') return reply(res, 200, await prepareSubchildDataUpdate(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/subchildren/set-data') return reply(res, 200, await prepareExistingSubchildData(await readBody(req)))

    return reply(res, 404, { error: 'Unknown route. See README.md for the /api/v1/ens/ endpoint list.' })
  } catch (error) {
    console.error('ENS API failed:', error.shortMessage || error.message)
    return reply(res, error.status || 502, { error: error.shortMessage || error.message })
  }
})

server.listen(port, async () => {
  console.log(`Hisaab ENSv2 API listening at http://localhost:${port}`)
  await startupChecks()
})
