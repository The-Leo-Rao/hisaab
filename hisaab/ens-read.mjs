import { createPublicClient, decodeAbiParameters, encodeFunctionData, hexToString, http, keccak256, parseAbi, toHex, zeroAddress } from 'viem'
import { namehash, normalize, packetToBytes } from 'viem/ens'
import { getNetwork, getRpcUrl } from '../network.mjs'

const network = getNetwork(process.env.VITE_NETWORK)
export const ens = createPublicClient({ chain: network.chain, transport: http(getRpcUrl(network, process.env)) })

export const HISAAB_KEYS = ['hisaab.registry', 'hisaab.wallet', 'hisaab.employer', 'hisaab.role', 'hisaab.client', 'hisaab.approved']

const registryAbi = parseAbi([
  'function getSubregistry(string label) view returns (address)',
  'function getResolver(string label) view returns (address)',
  'function findOwner(string label) view returns (address)',
  'function findExpiry(string label) view returns (uint64)',
  'function getStatus(uint256 anyId) view returns (uint8)',
])
const resolverAbi = parseAbi(['function resolve(bytes name, bytes data) view returns (bytes)'])
const profileAbi = parseAbi([
  'function data(bytes32 node, string key) view returns (bytes)',
  'function text(bytes32 node, string key) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
])
const STATUS = ['available', 'reserved', 'registered']

const labelId = (label) => BigInt(keccak256(toHex(label)))
const read = (address, abi, functionName, args) => ens.readContract({ address, abi, functionName, args })

export function normalizeName(name) {
  try {
    return normalize(String(name || '').trim())
  } catch {
    return null
  }
}

async function resolveField(resolver, name, call) {
  try {
    const out = await read(resolver, resolverAbi, 'resolve', [toHex(packetToBytes(name)), call])
    return out
  } catch {
    return null
  }
}

async function record(resolver, name, node, key) {
  const raw = await resolveField(resolver, name, encodeFunctionData({ abi: profileAbi, functionName: 'data', args: [node, key] }))
  if (raw && raw !== '0x') {
    const [bytes] = decodeAbiParameters([{ type: 'bytes' }], raw)
    if (bytes && bytes !== '0x') return hexToString(bytes)
  }
  const t = await resolveField(resolver, name, encodeFunctionData({ abi: profileAbi, functionName: 'text', args: [node, key] }))
  if (t && t !== '0x') {
    const [text] = decodeAbiParameters([{ type: 'string' }], t)
    if (text) return text
  }
  return null
}

export async function readName(input, keys = HISAAB_KEYS) {
  const name = normalizeName(input)
  if (!name || !name.endsWith('.eth')) return { name: input, valid: false, status: 'invalid' }
  const labels = name.split('.')
  const path = labels.slice(0, -1).reverse()
  let registry = network.registry
  const chain = []
  for (let i = 0; i < path.length - 1; i++) {
    const next = await read(registry, registryAbi, 'getSubregistry', [path[i]])
    chain.push({ label: path[i], registry, subregistry: next })
    if (next === zeroAddress) {
      return { name, valid: true, status: 'unregistered', reason: `${path.slice(0, i + 1).reverse().join('.')}.eth has no subname registry`, chain }
    }
    registry = next
  }
  const leaf = path.at(-1)
  const [statusCode, owner, expiry, resolver] = await Promise.all([
    read(registry, registryAbi, 'getStatus', [labelId(leaf)]),
    read(registry, registryAbi, 'findOwner', [leaf]),
    read(registry, registryAbi, 'findExpiry', [leaf]),
    read(registry, registryAbi, 'getResolver', [leaf]),
  ])
  const now = BigInt(Math.floor(Date.now() / 1000))
  let status = STATUS[statusCode] ?? `status-${statusCode}`
  if (status === 'registered' && expiry > 0n && expiry <= now) status = 'expired'
  if (status === 'available' && expiry > 0n && expiry <= now) status = 'expired'
  const node = namehash(name)
  const records = {}
  let addr = null
  if (resolver !== zeroAddress) {
    const values = await Promise.all(keys.map((k) => record(resolver, name, node, k)))
    keys.forEach((k, i) => (records[k] = values[i]))
    const a = await resolveField(resolver, name, encodeFunctionData({ abi: profileAbi, functionName: 'addr', args: [node] }))
    if (a && a !== '0x') {
      const [decoded] = decodeAbiParameters([{ type: 'address' }], a)
      if (decoded !== zeroAddress) addr = decoded
    }
  }
  return {
    name,
    valid: true,
    network: network.key,
    chainId: network.chain.id,
    status,
    owner: owner === zeroAddress ? null : owner,
    expiry: expiry > 0n ? expiry : null,
    registry,
    resolver: resolver === zeroAddress ? null : resolver,
    node,
    records,
    addr,
    wallet: records['hisaab.wallet'] || addr || null,
    revoked: (status === 'expired' || status === 'available') && resolver === zeroAddress && expiry > 0n,
  }
}
