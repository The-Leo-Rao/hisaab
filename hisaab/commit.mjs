import { encodeAbiParameters, keccak256 } from 'viem'
import { namehash } from 'viem/ens'
import { normalizeName } from './ens-read.mjs'

const HEX32 = /^0x[0-9a-fA-F]{64}$/
export const isHex32 = (v) => typeof v === 'string' && HEX32.test(v)
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

const nodeOf = (name) => namehash(normalizeName(name) ?? name)

export const issuerCommitment = (name, salt) =>
  keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [nodeOf(name), salt]))

export const walletCommitment = (wallet, nameSalt) =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [wallet, nameSalt]))

export const approvalCommitment = (id, salt) =>
  keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [BigInt(id), salt]))

export const nameSecretMessage = (name) =>
  `Hisaab name secret for ${name}\n\nThis signature stays in your browser. It does not move funds.`

export function walletMatches(record, wallet, nameSalt) {
  if (!record || !wallet) return false
  if (isHex32(record)) return isHex32(nameSalt) && same(record, walletCommitment(wallet, nameSalt))
  return same(record, wallet)
}

export function approvalListed(record, id, salt) {
  const entries = String(record || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (isHex32(salt) && entries.includes(approvalCommitment(id, salt).toLowerCase())) return true
  return entries.includes(`invoice:${id}`)
}

export const SEAL_ALG = 'A256GCM-HKDF-SHA256'

export function isSealedInvoice(s) {
  return !!s && s.v === 1 && s.alg === SEAL_ALG && /^\d+$/.test(String(s.id)) && isHex32(s.docHash) && typeof s.iv === 'string' && typeof s.ct === 'string'
}
