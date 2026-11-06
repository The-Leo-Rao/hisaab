import { getNetwork } from '../network.mjs'

const network=getNetwork(import.meta.env.VITE_NETWORK)
const params=new URLSearchParams(location.search)
const name=params.get('name')||'ENS name'
const owner=params.get('owner')||''
const tx=params.get('tx')||''
const button=document.getElementById('ens-name')
const ownerEl=document.getElementById('owner')
button.textContent=name
button.onclick=()=>{
  const expanded=button.getAttribute('aria-expanded')==='true'
  button.setAttribute('aria-expanded',String(!expanded))
  ownerEl.hidden=expanded
  ownerEl.textContent=expanded?'':owner
}
const link=document.getElementById('tx-link')
link.href=`${network.explorerUrl}/tx/${encodeURIComponent(tx)}`
link.textContent=`View transaction on ${network.displayName} Etherscan`
