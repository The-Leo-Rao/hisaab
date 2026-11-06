import { mainnet, sepolia } from 'viem/chains'

// This is the single source of truth for every chain-specific value.
// The selected profile comes from VITE_NETWORK in .env.
const networks = {
  sepolia: {
    key: 'sepolia',
    chain: sepolia,
    displayName: 'Sepolia',
    rpcEnvironmentVariable: 'VITE_SEPOLIA_RPC_URL',
    defaultRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.etherscan.io',
    registrar: '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3',
    registry: '0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4',
    paymentToken: '0x240b0316df57887dbbe58b586508b19e633a14aa',
    paymentTokenName: 'MockUSDC',
    canMintPaymentToken: true,
    supportsTopLevelRegistration: true,
  },
  mainnet: {
    key: 'mainnet',
    chain: mainnet,
    displayName: 'Ethereum Mainnet',
    rpcEnvironmentVariable: 'VITE_MAINNET_RPC_URL',
    defaultRpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerUrl: 'https://etherscan.io',
    registrar: '0xd6d8369e55c94ae8afa714e6cf7ab5be54d5cc81',
    registry: '0xf60aba43e1f7f3dab1186ff03b561401c9df85e2',
    paymentToken: undefined,
    paymentTokenName: undefined,
    canMintPaymentToken: false,
    // ENSv2 contracts are deployed on mainnet, but ENS currently uses the
    // ENSv1 registration flow there. This application implements ENSv2 only.
    supportsTopLevelRegistration: false,
    topLevelRegistrationMessage: 'Top-level .eth registration is disabled on Ethereum Mainnet because this app only implements the ENSv2 registration flow. Mainnet registrations currently use ENSv1.',
  },
}

export function getNetwork(key = 'sepolia') {
  const network = networks[String(key).toLowerCase()]
  if (!network) throw new Error(`Unsupported VITE_NETWORK "${key}". Use "sepolia" or "mainnet".`)
  return network
}

export function getRpcUrl(network, environment) {
  return environment[network.rpcEnvironmentVariable] || network.defaultRpcUrl
}

export { networks }
