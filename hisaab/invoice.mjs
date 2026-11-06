import canonicalize from 'canonicalize'
import { formatUnits, keccak256, toBytes } from 'viem'

export function canonical(doc) {
  const s = canonicalize(doc)
  if (s === undefined) throw Object.assign(new Error('Invoice document is not valid JSON.'), { status: 400 })
  return s
}

export const docHash = (doc) => keccak256(toBytes(canonical(doc)))

export function money(units) {
  const [w, f = ''] = formatUnits(BigInt(units), 6).split('.')
  return `${w}.${f.padEnd(2, '0')}`
}

export function isoDate(ts) {
  const n = Number(ts)
  return n ? new Date(n * 1000).toISOString().slice(0, 10) : null
}

export function longDate(ts) {
  const n = Number(ts)
  return n ? new Date(n * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null
}

export function decodeFragmentDoc(fragment) {
  return import('node:zlib').then(({ gunzipSync }) => {
    const d = new URLSearchParams(String(fragment || '').replace(/^#/, '')).get('d')
    if (!d) return null
    const buf = Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    return JSON.parse(gunzipSync(buf).toString('utf8'))
  })
}

export function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
}
