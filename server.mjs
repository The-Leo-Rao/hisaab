import { createServer } from 'node:http'
import { createPublicClient, http } from 'viem'
import { normalize } from 'viem/ens'
import { sepolia } from 'viem/chains'

const registrar = '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3'
const abi = [{
  type: 'function', name: 'isAvailable', stateMutability: 'view',
  inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'bool' }],
}]
const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL || undefined),
})
const port = Number(process.env.PORT || 3000)

function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return reply(res, 204, {})
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/api/ens/availability') {
    const raw = url.searchParams.get('name')
    if (!raw) return reply(res, 400, { error: 'Missing required query parameter: name (example: myname.eth)' })
    let name
    try { name = normalize(raw.trim()) } catch {
      return reply(res, 400, { error: 'Invalid ENS name.' })
    }
    const labels = name.split('.')
    if (labels.length !== 2 || labels[1] !== 'eth') {
      return reply(res, 400, { error: 'Provide a top-level .eth name, such as myname.eth.' })
    }
    try {
      const available = await client.readContract({
        address: registrar, abi, functionName: 'isAvailable', args: [labels[0]],
      })
      return reply(res, 200, { name, available, network: 'sepolia' })
    } catch (error) {
      console.error('ENS availability RPC failed:', error.shortMessage || error.message)
      return reply(res, 502, { error: 'Could not check ENS availability on Sepolia. Try again later.' })
    }
  }
  return reply(res, 404, { error: 'Not found. Use GET /api/ens/availability?name=myname.eth' })
})

server.listen(port, () => console.log(`ENS availability API listening at http://localhost:${port}`))
