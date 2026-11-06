import { writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, encodeFunctionData, http, maxUint256, parseAbi, parseEventLogs, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const RPC = process.env.ENS_RPC || 'http://127.0.0.1:8546'
const API = (process.env.API || 'http://localhost:3000').replace(/\/$/, '')
const FORK = process.env.DEMO_FORK === '1'

const WC_WALLETS = {
  ravi: process.env.WC_RAVI || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  acme: process.env.WC_ACME || '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  priya: process.env.WC_PRIYA || '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  arjun: process.env.WC_ARJUN || '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
}
const CONTROLLERS = ['acme', 'ravi']

const FACTORY = '0xda70306c98e97ece36f997a21368e53298572991'
const USER_REGISTRY_IMPL = '0x9bd8a88719068d09ecee662f36c0e3856708366a'
const RESOLVER_IMPL = '0x115eb53f0c60696633855f90b138178fb40b2b2c'
const MOCK_USDC = '0x240b0316df57887dbbe58b586508b19e633a14aa'
const REGISTRAR = '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3'

const admin = (r) => r | (r << 128n)
const REGISTRY_ROLES = [0n, 12n, 16n, 20n, 24n].reduce((acc, b) => acc | admin(1n << b), 0n)
const RESOLVER_ROLES = [0n, 4n, 24n].reduce((acc, b) => acc | admin(1n << b), 0n)
const DAY = 86_400n

const chain = { ...sepolia, rpcUrls: { default: { http: [RPC] } } }
const pub = createPublicClient({ chain, transport: http(RPC) })
const log = (...a) => console.log(...a)

const wallets = {}
for (const who of CONTROLLERS) {
  const k = process.env[`${who.toUpperCase()}_ENS_PK`] || (FORK ? generatePrivateKey() : null)
  if (!k) throw new Error(`Set ${who.toUpperCase()}_ENS_PK (a funded Sepolia key), or DEMO_FORK=1 on a local fork.`)
  wallets[who] = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(k) })
  if (FORK) await pub.request({ method: 'anvil_setBalance', params: [wallets[who].account.address, '0x56BC75E2D63100000'] })
}
const addr = (who) => wallets[who].account.address

const factoryAbi = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address)',
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
])
const initRegistryAbi = parseAbi(['function initialize((address account, uint256 roleBitmap)[] grants)'])
const initResolverAbi = parseAbi(['function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)'])
const erc20Abi = parseAbi(['function mint(address to, uint256 amount)', 'function approve(address spender, uint256 value) returns (bool)', 'function decimals() view returns (uint8)'])

async function send(who, tx, label) {
  const hash = await wallets[who].sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value || 0) })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${label} reverted (${hash})`)
  log(`  ok  ${label}`)
  return r
}

async function api(path, body) {
  const res = await fetch(`${API}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  const j = await res.json()
  if (!res.ok) throw new Error(`${path}: ${j.error}`)
  return j
}

async function proxy(who, impl, initData, label) {
  const salt = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))))
  const data = encodeFunctionData({ abi: factoryAbi, functionName: 'deployProxy', args: [impl, salt, initData] })
  const r = await send(who, { to: FACTORY, data }, label)
  const [ev] = parseEventLogs({ abi: factoryAbi, eventName: 'ProxyDeployed', logs: r.logs })
  return ev.args.proxyAddress
}

const userRegistry = (who, label) =>
  proxy(who, USER_REGISTRY_IMPL, encodeFunctionData({ abi: initRegistryAbi, functionName: 'initialize', args: [[{ account: addr(who), roleBitmap: REGISTRY_ROLES }]] }), `UserRegistry for ${label}`)
const resolver = (who, label) =>
  proxy(who, RESOLVER_IMPL, encodeFunctionData({ abi: initResolverAbi, functionName: 'initialize', args: [[{ account: addr(who), roleBitmap: RESOLVER_ROLES }], []] }), `PermissionedResolver for ${label}`)

async function commit(who, name, subregistry, resolverAddr) {
  const body = { name, owner: addr(who), from: addr(who), duration: String(365n * DAY), subregistry, resolver: resolverAddr }
  const tx = await api('/api/v1/ens/register/prepare-commit', body)
  await send(who, tx, `commit ${name}`)
  return { ...body, secret: tx.secret, commitment: tx.commitment }
}

async function reveal(who, pending) {
  if (FORK) {
    await pub.request({ method: 'evm_increaseTime', params: [90] })
    await pub.request({ method: 'evm_mine', params: [] })
  }
  for (;;) {
    const s = await api(`/api/v1/ens/register/commitment-status?commitment=${pending.commitment}`)
    if (s.canReveal) break
    log(`  ..  waiting ${s.remainingSeconds}s for ${pending.name}`)
    await new Promise((r) => setTimeout(r, Math.min(Number(s.remainingSeconds) + 2, 30) * 1000))
  }
  await send(who, await api('/api/v1/ens/register/prepare-reveal', pending), `register ${pending.name}`)
}

async function child(who, name, extra) {
  await send(who, await api('/api/v1/ens/children/create', { name, from: addr(who), ...extra }), `create ${name}`)
}

async function records(who, body) {
  const out = await api('/api/v1/hisaab/ens/records', { from: addr(who), ...body })
  for (const tx of out.transactions) await send(who, tx, `${body.name} ${tx.key}`)
}

const status = await api('/api/v1/hisaab/status')
log(`Hisaab registry ${status.whitechain.registry} on chain ${status.whitechain.chainId}`)
log(`ENS controllers: acme ${addr('acme')}, ravi ${addr('ravi')}`)

log('1. Fees: MockUSDC for name registration')
const decimals = await pub.readContract({ address: MOCK_USDC, abi: erc20Abi, functionName: 'decimals' })
for (const who of CONTROLLERS) {
  await send(who, { to: MOCK_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'mint', args: [addr(who), 1000n * 10n ** BigInt(decimals)] }) }, `mint MockUSDC to ${who}`)
  await send(who, { to: MOCK_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [REGISTRAR, maxUint256] }) }, `approve registrar for ${who}`)
}

log('2. Registries and resolvers (VerifiableFactory proxies)')
const acmeRegistry = await userRegistry('acme', 'acme-labs.eth')
const devRegistry = await userRegistry('acme', 'dev.acme-labs.eth')
const raviRegistry = await userRegistry('ravi', 'ravi-dev.eth')
const acmeResolver = await resolver('acme', 'acme-labs.eth')
const raviResolver = await resolver('ravi', 'ravi-dev.eth')
const contractorResolvers = {}
for (const who of ['ravi', 'priya', 'arjun']) contractorResolvers[who] = await resolver('acme', `${who}.dev.acme-labs.eth`)
const engagementResolver = await resolver('ravi', 'acme-q4.ravi-dev.eth')

log('3. Register parents (teammate: prepare-commit, commitment-status, prepare-reveal)')
const pAcme = await commit('acme', 'acme-labs.eth', acmeRegistry, acmeResolver)
const pRavi = await commit('ravi', 'ravi-dev.eth', raviRegistry, raviResolver)
await reveal('acme', pAcme)
await reveal('ravi', pRavi)

log('4. Subnames (teammate: children/create)')
const now = BigInt(Math.floor(Date.now() / 1000))
await child('acme', 'dev.acme-labs.eth', { childRegistry: devRegistry })
for (const who of ['ravi', 'priya', 'arjun']) {
  await child('acme', `${who}.dev.acme-labs.eth`, { resolver: contractorResolvers[who], expiry: String(now + 180n * DAY) })
}
await child('ravi', 'acme-q4.ravi-dev.eth', { resolver: engagementResolver, expiry: String(now + 120n * DAY) })

log('5. Hisaab records (hisaab ens/records -> teammate subchildren/set-data for subnames)')
const reg = `${status.whitechain.chainId}:${status.whitechain.registry}`
await records('acme', { name: 'acme-labs.eth', records: [{ key: 'hisaab.wallet', value: WC_WALLETS.acme }, { key: 'hisaab.registry', value: reg }] })
await records('ravi', { name: 'ravi-dev.eth', records: [{ key: 'hisaab.wallet', value: WC_WALLETS.ravi }, { key: 'hisaab.registry', value: reg }] })
const roles = { ravi: 'Software Engineer, contract', priya: 'Product Designer, contract', arjun: 'QA Engineer, contract' }
for (const who of ['ravi', 'priya', 'arjun']) {
  await records('acme', { name: `${who}.dev.acme-labs.eth`, kind: 'contractor', issuer: WC_WALLETS[who], employer: 'acme-labs.eth', role: roles[who] })
}
await records('ravi', { name: 'acme-q4.ravi-dev.eth', kind: 'freelance', issuer: WC_WALLETS.ravi, client: 'acme-labs.eth' })

log('6. Let the client acknowledge invoices on the engagement name')
await send('ravi', await api('/api/v1/hisaab/ens/client-role', { name: 'acme-q4.ravi-dev.eth', from: addr('ravi'), client: addr('acme') }), 'grant acme hisaab.approved')

const out = {
  rpc: RPC,
  names: {
    company: 'acme-labs.eth',
    freelancer: 'ravi-dev.eth',
    engagement: 'acme-q4.ravi-dev.eth',
    contractors: ['ravi.dev.acme-labs.eth', 'priya.dev.acme-labs.eth', 'arjun.dev.acme-labs.eth'],
  },
  ensControllers: Object.fromEntries(CONTROLLERS.map((w) => [w, addr(w)])),
  whitechainWallets: WC_WALLETS,
  contracts: { acmeRegistry, devRegistry, raviRegistry, acmeResolver, raviResolver, engagementResolver, contractorResolvers },
}
if (FORK) out.forkKeys = Object.fromEntries(CONTROLLERS.map((w) => [w, wallets[w].account.address]))
writeFileSync(new URL('../../.ens-demo.json', import.meta.url), JSON.stringify(out, null, 2))
log('Done. Wrote .ens-demo.json')
for (const n of ['acme-labs.eth', 'acme-q4.ravi-dev.eth', 'ravi.dev.acme-labs.eth']) {
  const r = await api(`/api/v1/hisaab/ens/name?name=${n}`)
  log(`  ${n}: ${r.status}, wallet ${r.wallet}, records ${Object.entries(r.records).filter(([, v]) => v).map(([k]) => k).join(', ')}`)
}
