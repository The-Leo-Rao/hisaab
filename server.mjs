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
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { normalize } from 'viem/ens'
import { getNetwork, getRpcUrl } from './network.mjs'

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
  return {
    action,
    name,
    parent,
    from,
    to,
    data,
    value: `0x${value.toString(16)}`,
    chainId,
    ...metadata,
    note: 'Unsigned transaction. Send it from the connected wallet after reviewing it; this API never stores a key or broadcasts a transaction.',
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

function labelId(label) {
  return BigInt(keccak256(toHex(label)))
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
// Router
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (req.method === 'OPTIONS') return reply(res, 204, {})

  try {
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

    // Subname create / modify / revoke
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/children/create') return reply(res, 200, await prepareCreate(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/children/modify') return reply(res, 200, await prepareModify(await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/v1/ens/children/revoke') return reply(res, 200, await prepareRevoke(await readBody(req)))

    return reply(res, 404, { error: 'Unknown route. See README.md for the /api/v1/ens/ endpoint list.' })
  } catch (error) {
    console.error('ENS API failed:', error.shortMessage || error.message)
    return reply(res, error.status || 502, { error: error.shortMessage || error.message })
  }
})

server.listen(port, () => console.log(`Hisaab ENSv2 API listening at http://localhost:${port}`))
