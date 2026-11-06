import { existsSync, readFileSync } from 'node:fs'

const deployFile = process.env.HISAAB_DEPLOY_FILE
const local = deployFile && existsSync(deployFile) ? JSON.parse(readFileSync(deployFile, 'utf8')) : {}
const port = Number(process.env.PORT || 3000)

export const config = {
  wcRpc: process.env.WC_RPC || local.rpcUrl || 'https://rpc.testnet.whitechain.io',
  wcChainId: Number(process.env.WC_CHAIN_ID || local.chainId || 1874),
  registry: process.env.HISAAB_REGISTRY || local.registry,
  receipt: process.env.HISAAB_RECEIPT || local.receipt,
  usdt: process.env.HISAAB_USDT || local.usdt || '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7',
  deployBlock: BigInt(process.env.HISAAB_DEPLOY_BLOCK || local.deployBlock || 0),
  explorer: process.env.WC_EXPLORER || 'https://explorer.testnet.whitechain.io',
  publicBase: (process.env.HISAAB_PUBLIC_BASE || `http://localhost:${port}`).replace(/\/$/, ''),
  selfBase: `http://127.0.0.1:${port}`,
}

export function verifyUrl(id) {
  return `${config.publicBase}/verify/${id}`
}

export function requireDeployment() {
  if (!config.registry || !config.receipt) {
    throw Object.assign(new Error('Hisaab contracts are not configured. Set HISAAB_REGISTRY and HISAAB_RECEIPT (or HISAAB_DEPLOY_FILE).'), { status: 503 })
  }
}
