import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createPublicClient, http, isAddress } from 'viem'
import { normalize } from 'viem/ens'
import { getNetwork, getRpcUrl } from './network.mjs'

const network = getNetwork(process.env.VITE_NETWORK)
const registrar = network.registrar
const registrarAbi = [{
  type: 'function', name: 'isAvailable', stateMutability: 'view',
  inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'bool' }],
}]
const client = createPublicClient({
  chain: network.chain,
  transport: http(getRpcUrl(network, process.env)),
})
const prompt = createInterface({ input, output })

try {
  if (!network.supportsTopLevelRegistration) throw new Error(network.topLevelRegistrationMessage)
  const rawName = (await prompt.question('ENS name to check (example: myname.eth): ')).trim()
  let name
  try { name = normalize(rawName) } catch { throw new Error('That is not a valid ENS name.') }
  const parts = name.split('.')
  if (parts.length !== 2 || parts[1] !== 'eth') {
    throw new Error('Enter a top-level .eth name, such as myname.eth (not a subname).')
  }
  const [label] = parts
  console.log(`Checking ${name} on ENSv2 ${network.displayName}…`)
  const available = await client.readContract({
    address: registrar, abi: registrarAbi, functionName: 'isAvailable', args: [label],
  })
  if (!available) {
    console.log(`${name} is not available. No registration was created.`)
    process.exitCode = 1
  } else {
    console.log(`${name} is available.`)
    const address = (await prompt.question('Address to use as the name owner: ')).trim()
    if (!isAddress(address)) throw new Error('That is not a valid Ethereum address.')
    console.log('\nMOCK REGISTRATION (temporary placeholder; no transaction sent)')
    console.log(JSON.stringify({ name, owner: address, status: 'mock-ready', network: network.displayName }, null, 2))
  }
} catch (error) {
  console.error(`Error: ${error.shortMessage || error.message}`)
  process.exitCode = 1
} finally {
  prompt.close()
}
