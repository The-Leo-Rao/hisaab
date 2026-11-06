# Hisaab ENSv2 test API

This local API prepares unsigned ENSv2 transactions. The browser wallet signs and broadcasts every transaction. The API never receives a private key.

## Network selection

`.env` controls the network for the browser, API, and CLI:

```dotenv
VITE_NETWORK=sepolia
```

Change only `VITE_NETWORK` to select another network profile. The contract addresses, chain ID, explorer, wallet network, and default RPC are resolved from [network.mjs](./network.mjs). To use a private RPC provider, set the matching `VITE_SEPOLIA_RPC_URL` or `VITE_MAINNET_RPC_URL`; it will be selected with its network profile.

`mainnet` is an available profile for ENSv2 hierarchy management. Top-level `.eth` registrations remain disabled there: this application implements the ENSv2 registration flow, while ENS currently uses its ENSv1 registration flow on Ethereum Mainnet. Keep `sepolia` for the included test registration page.

## Parent-controlled hierarchy

For each root parent, such as `iownthis.eth`, children created by this API are registered to the same root-parent wallet. The child role bitmap is explicitly set to `0`: child names have no separate owner wallet and no independent permission to alter, renew, revoke, or create names.

The root-parent wallet is the sole controller. It must hold these ENSv2 roles in each registry that manages its children:

| Action | Required role |
| --- | --- |
| Create child | `ROLE_REGISTRAR` |
| Change child's resolver | `ROLE_SET_RESOLVER` |
| Extend child's expiry | `ROLE_RENEW` |
| Revoke child | `ROLE_UNREGISTER` |

The API verifies that `from` is the active owner of the top-level parent before it returns a transaction. This policy applies to children made by these endpoints. Existing children that were assigned to another wallet remain unchanged until you reconfigure them onchain.

## Start

```bash
npm install
npm run api
```

The API runs on `http://localhost:3000`. It automatically reads `.env` and uses the selected network's default RPC endpoint unless that network has an RPC override.

## Endpoint reference

All endpoints return JSON. The transaction-building endpoints return `to`, `data`, `value`, `from`, and `chainId`; pass these values to the connected browser wallet after reviewing them.

### Check a `.eth` name

```bash
curl 'http://localhost:3000/api/ens/availability?name=iownthis.eth'
```

### Check parent hierarchy permissions

```bash
curl 'http://localhost:3000/api/ens/children/status?parent=iownthis.eth&from=0xROOT_PARENT_WALLET'
```

The response identifies the child registry and reports whether the root wallet can create, modify, extend, and revoke names.

### Create a child

```bash
curl -X POST http://localhost:3000/api/ens/children/create \
  -H 'content-type: application/json' \
  -d '{"name":"team.iownthis.eth","from":"0xROOT_PARENT_WALLET"}'
```

Optional inputs:

- `expiry`: future Unix timestamp. Defaults to one year from now.
- `resolver`: an existing resolver address.
- `childRegistry`: an already deployed and root-wallet-administered UserRegistry address. Attach one when this child needs to become a parent for deeper subnames.

There is intentionally no `owner` input. The endpoint always makes the root wallet the name owner.

### Modify a child

Set the resolver:

```bash
curl -X POST http://localhost:3000/api/ens/children/modify \
  -H 'content-type: application/json' \
  -d '{"name":"team.iownthis.eth","from":"0xROOT_PARENT_WALLET","resolver":"0xRESOLVER"}'
```

Extend expiry:

```bash
curl -X POST http://localhost:3000/api/ens/children/modify \
  -H 'content-type: application/json' \
  -d '{"name":"team.iownthis.eth","from":"0xROOT_PARENT_WALLET","expiry":1800000000}'
```

### Revoke a child

```bash
curl -X POST http://localhost:3000/api/ens/children/revoke \
  -H 'content-type: application/json' \
  -d '{"name":"team.iownthis.eth","from":"0xROOT_PARENT_WALLET"}'
```

This creates an ENSv2 `unregister` transaction. Once the root wallet signs and sends it, the child becomes available again.

## Frontend integration

```js
const prepared = await fetch('/api/ens/children/create', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'team.iownthis.eth', from: account }),
}).then((response) => response.json())

const hash = await walletClient.sendTransaction({
  account,
  to: prepared.to,
  data: prepared.data,
  value: 0n,
  chain: network.chain,
})
```

The root parent must already have a child UserRegistry/subregistry attached and the root wallet must already have the listed root roles. Deploying and initially configuring those registries is a separate ENSv2 setup transaction.
