import { createPublicClient, createWalletClient, custom, http, isAddress, formatUnits, parseAbi, keccak256, toHex, zeroAddress, zeroHash } from 'viem'
import { normalize } from 'viem/ens'
import { getNetwork, getRpcUrl } from '../network.mjs'

const network=getNetwork(import.meta.env.VITE_NETWORK)
const {chain,registrar:REGISTRAR,paymentToken:USDC}=network
const rpcUrl=getRpcUrl(network,import.meta.env)
const registrarAbi=parseAbi([
 'function isAvailable(string label) view returns (bool)',
 'function getRegisterPrice(string label,uint64 duration,address paymentToken) view returns (uint256 base,uint256 premium)',
 'function makeCommitment(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,bytes32 referrer) pure returns (bytes32)',
 'function commit(bytes32 commitment)',
 'function commitmentAt(bytes32 commitment) view returns (uint64)',
 'function MIN_COMMITMENT_AGE() view returns (uint64)',
 'function MIN_REGISTER_DURATION() view returns (uint64)',
 'function register(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 referrer) returns (uint256 tokenId)',
])
const tokenAbi=parseAbi(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)','function mint(address,uint256)'])
const pub=createPublicClient({chain,transport:http(rpcUrl)})
const $=id=>document.getElementById(id)
let wc,account,quote,registration,timerId
const say=s=>{$('status').textContent=s}
const fmt=a=>`${a.slice(0,6)}…${a.slice(-4)}`
const assertTopLevelRegistration=()=>{if(!network.supportsTopLevelRegistration)throw Error(network.topLevelRegistrationMessage)}

function providerFor(kind){
  if(kind==='phantom')return window.phantom?.ethereum || window.ethereum?.providers?.find(p=>p.isPhantom) || null
  const providers=window.ethereum?.providers
  return providers?.find(p=>p.isMetaMask&&!p.isPhantom) || (window.ethereum?.isMetaMask?window.ethereum:null)
}
async function connect(kind){
  const provider=providerFor(kind)
  if(!provider)throw Error(`${kind==='phantom'?'Phantom':'MetaMask'} extension was not detected in this browser.`)
  wc=createWalletClient({chain,transport:custom(provider)})
  const [a]=await wc.requestAddresses(); account=a
  const chain=await wc.getChainId()
  if(chain!==network.chain.id){
    const chainId=`0x${network.chain.id.toString(16)}`
    try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId}]})}
    catch(e){if(e.code!==4902)throw e;await provider.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:network.displayName,nativeCurrency:network.chain.nativeCurrency,rpcUrls:[rpcUrl],blockExplorerUrls:[network.explorerUrl]}]})}
  }
  $('wallet').textContent=`${kind==='phantom'?'Phantom':'MetaMask'} · ${fmt(account)} · ${network.displayName}`
  say('Wallet connected. Next, check a .eth name.')
}
function getLabel(){
 const raw=$('label').value.trim().replace(/\.eth$/i,'')
 const name=normalize(`${raw}.eth`)
 if(name.split('.').length!==2)throw Error('Enter one name label only, for example myname.')
 return name.slice(0,-4)
}
async function check(){
 assertTopLevelRegistration()
 if(!account)throw Error('Connect MetaMask or Phantom first.')
 const label=getLabel()
 const [available,[base,premium],minDuration]=await Promise.all([
  pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'isAvailable',args:[label]}),
  pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'getRegisterPrice',args:[label,31536000n,USDC]}),
  pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'MIN_REGISTER_DURATION'}),
 ])
 if(!available){quote=undefined;$('begin').disabled=true;$('mint').disabled=true;throw Error(`${label}.eth is not available on ${network.displayName}. No registration started.`)}
 quote={label,total:base+premium,duration:31536000n,minDuration}
 if(quote.duration<minDuration)throw Error('Configured duration is below ENS registrar minimum.')
 const balance=await pub.readContract({address:USDC,abi:tokenAbi,functionName:'balanceOf',args:[account]})
 $('quote').textContent=`${label}.eth is available. One-year test price: ${formatUnits(quote.total,6)} ${network.paymentTokenName}. Your balance: ${formatUnits(balance,6)}.`
 $('mint').disabled=false;$('begin').disabled=false
 say(`Availability checked. The next steps require ${network.displayName} test ETH for gas and ${network.paymentTokenName} for the registration fee.`)
}
async function mint(){
 if(!network.canMintPaymentToken)throw Error(`This network does not provide a mintable ${network.paymentTokenName||'test'} token.`)
 if(!account)throw Error('Connect a wallet first.')
 say('Requesting 100 test USDC. Confirm the mint transaction in your wallet.')
 const hash=await wc.writeContract({account,chain,address:USDC,abi:tokenAbi,functionName:'mint',args:[account,100_000000n]})
 await pub.waitForTransactionReceipt({hash});say('Test USDC minted. Check the name and price again before continuing.')
}
async function begin(){
 assertTopLevelRegistration()
 if(!quote||!account)throw Error('Connect a wallet and check an available name first.')
 const secret=keccak256(toHex(crypto.randomUUID()))
 const commitment=await pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'makeCommitment',args:[quote.label,account,secret,zeroAddress,zeroAddress,quote.duration,zeroHash]})
 const bal=await pub.readContract({address:USDC,abi:tokenAbi,functionName:'balanceOf',args:[account]})
 if(bal<quote.total)throw Error(`Insufficient ${network.paymentTokenName}. Need ${formatUnits(quote.total,6)}; click Get test USDC first.`)
 const allowance=await pub.readContract({address:USDC,abi:tokenAbi,functionName:'allowance',args:[account,REGISTRAR]})
 if(allowance<quote.total){say(`Approve ${network.paymentTokenName} spending. Confirm the approval in your wallet.`);const ah=await wc.writeContract({account,chain,address:USDC,abi:tokenAbi,functionName:'approve',args:[REGISTRAR,quote.total]});await pub.waitForTransactionReceipt({hash:ah})}
 say('Submitting ENS commitment. Confirm the transaction in your wallet.')
 const hash=await wc.writeContract({account,chain,address:REGISTRAR,abi:registrarAbi,functionName:'commit',args:[commitment]})
 await pub.waitForTransactionReceipt({hash})
 const committedAt=await pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'commitmentAt',args:[commitment]})
 registration={label:quote.label,secret,commitment,committedAt,owner:account,duration:quote.duration}
 sessionStorage.setItem('hisaab-ens-pending',JSON.stringify({...registration,secret,commitment,committedAt:committedAt.toString(),duration:quote.duration.toString()}))
 say(`Commit confirmed. ENS requires a reveal delay before registration. Commit tx: ${hash}`)
 tick()
}
function tick(){clearInterval(timerId);timerId=setInterval(async()=>{
 if(!registration)return
 const age=await pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'MIN_COMMITMENT_AGE'})
 const remain=Number(age)-(Math.floor(Date.now()/1000)-Number(registration.committedAt))
 $('timer').textContent=remain>0?`Reveal available in ${remain} seconds.`:'Reveal is ready.'
 $('reveal').disabled=remain>0
 if(remain<=0)clearInterval(timerId)
},1000);tickOnce()}
async function tickOnce(){if(!registration)return;const age=await pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'MIN_COMMITMENT_AGE'});const remain=Number(age)-(Math.floor(Date.now()/1000)-Number(registration.committedAt));$('timer').textContent=remain>0?`Reveal available in ${remain} seconds.`:'Reveal is ready.';$('reveal').disabled=remain>0}
async function reveal(){
 assertTopLevelRegistration()
 if(!registration||registration.owner.toLowerCase()!==account.toLowerCase())throw Error('Reconnect the wallet that created the commitment.')
 const min=await pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'MIN_COMMITMENT_AGE'})
 const age=BigInt(Math.floor(Date.now()/1000))-registration.committedAt
 if(age<min)throw Error('Commitment is not ready to reveal yet.')
 const [available,[base,premium]]=await Promise.all([
  pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'isAvailable',args:[registration.label]}),
  pub.readContract({address:REGISTRAR,abi:registrarAbi,functionName:'getRegisterPrice',args:[registration.label,registration.duration,USDC]}),
 ])
 if(!available)throw Error('Name is no longer available. Commitment cannot complete a registration.')
 const total=base+premium;const allowance=await pub.readContract({address:USDC,abi:tokenAbi,functionName:'allowance',args:[account,REGISTRAR]})
 if(allowance<total){say('Price changed or approval is insufficient. Approve the updated amount.');const ah=await wc.writeContract({account,chain,address:USDC,abi:tokenAbi,functionName:'approve',args:[REGISTRAR,total]});await pub.waitForTransactionReceipt({hash:ah})}
 say('Submitting registration and payment. Confirm the transaction in your wallet.')
 const hash=await wc.writeContract({account,chain,address:REGISTRAR,abi:registrarAbi,functionName:'register',args:[registration.label,account,registration.secret,zeroAddress,zeroAddress,registration.duration,USDC,zeroHash]})
 await pub.waitForTransactionReceipt({hash});sessionStorage.removeItem('hisaab-ens-pending');registration=undefined
 const name=`${$('label').value.trim().replace(/\.eth$/i,'')}.eth`
 window.location.href=`/success.html?name=${encodeURIComponent(name)}&owner=${encodeURIComponent(account)}&tx=${encodeURIComponent(hash)}`
}
const saved=sessionStorage.getItem('hisaab-ens-pending')
if(saved){try{const x=JSON.parse(saved);registration={...x,committedAt:BigInt(x.committedAt),duration:BigInt(x.duration),secret:x.secret,commitment:x.commitment};$('label').value=x.label;tick()}catch{sessionStorage.removeItem('hisaab-ens-pending')}}

if(!network.supportsTopLevelRegistration){
 for(const id of ['check','mint','begin','reveal'])$(id).disabled=true
 $('status').textContent=network.topLevelRegistrationMessage
}

for(const [id,fn] of [['metamask',()=>connect('metamask')],['phantom',()=>connect('phantom')],['check',check],['mint',mint],['begin',begin],['reveal',reveal]])$(id).onclick=()=>fn().catch(e=>say(e.shortMessage||e.message))
