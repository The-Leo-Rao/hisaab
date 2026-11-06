import { docHash } from './invoice.mjs'
import { SEAL_ALG, isSealedInvoice } from './commit.mjs'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const enc = new TextEncoder()
const hexBytes = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'))
const b64u = (u) => Buffer.from(u).toString('base64url')
const unb64u = (s) => Uint8Array.from(Buffer.from(s, 'base64url'))

export function generateInvoiceKey(id) {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(26)), (b) => ALPHABET[b & 31]).join('')
  return `HSB${id}-${secret.match(/.{1,4}/g).join('-')}`
}

export function parseInvoiceKey(input) {
  const raw = String(input ?? '').toUpperCase().replace(/\s+/g, '')
  const m = raw.match(/^(?:HSB(\d+)-)?([0-9A-Z-]+)$/)
  if (!m) return null
  const body = m[2].replace(/-/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (body.length !== 26 || [...body].some((c) => !ALPHABET.includes(c))) return null
  return { id: m[1] ?? null, secret: body }
}

async function aesKey(input, hash, id) {
  const k = parseInvoiceKey(input)
  if (!k) throw new Error("That doesn't look like a Hisaab invoice key.")
  if (k.id !== null && k.id !== String(id)) throw new Error(`This key belongs to invoice #${k.id}, not #${id}.`)
  const ikm = await crypto.subtle.importKey('raw', enc.encode(k.secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: hexBytes(hash), info: enc.encode(`hisaab/seal/v1/${id}`) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function sealInvoice(doc, id, key) {
  const hash = docHash(doc)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const k = await aesKey(key, hash, id)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: hexBytes(hash) }, k, enc.encode(JSON.stringify(doc))))
  return { v: 1, alg: SEAL_ALG, id: String(id), docHash: hash, iv: b64u(iv), ct: b64u(ct) }
}

export async function openInvoice(sealed, key) {
  if (!isSealedInvoice(sealed)) throw new Error('Not a sealed Hisaab invoice.')
  const k = await aesKey(key, sealed.docHash, sealed.id)
  let plain
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(sealed.iv), additionalData: hexBytes(sealed.docHash) }, k, unb64u(sealed.ct))
  } catch {
    throw new Error('Wrong key for this invoice.')
  }
  const doc = JSON.parse(new TextDecoder().decode(plain))
  if (docHash(doc).toLowerCase() !== sealed.docHash.toLowerCase()) throw new Error('The sealed invoice was altered.')
  return doc
}
