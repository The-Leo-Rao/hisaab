# Hisaab ENSv2 API

UI-free ENSv2 transaction preparation service. Every endpoint returns unsigned transaction data; the connected browser wallet signs and broadcasts. This API never receives a private key.

## Run

```bash
npm install
npm run api
```

The API listens on `http://localhost:3000` (override with `PORT=`).

## Network selection

`.env` controls the chain profile:

```dotenv
VITE_NETWORK=sepolia
```

Profiles are defined in [`network.mjs`](./network.mjs). To use a private RPC, set the matching override:

```dotenv
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com
```

Top-level `.eth` registration is only enabled on **Sepolia** because it uses the ENSv2 registrar + MockUSDC test token. Mainnet supports hierarchy management only.

---

## Endpoint reference

All endpoints return JSON. `POST` transaction-building endpoints return an unsigned transaction object:

```json
{
  "action": "ens-register-commit",
  "name": "myname.eth",
  "from": "0x...",
  "to": "0x...",
  "data": "0x...",
  "value": "0x0",
  "chainId": 11155111,
  ...metadata...
}
```

Pass `to`, `data`, `value`, and `chainId` to the connected wallet (`viem`, `ethers`, MetaMask, etc.).

---

### Status / connection check

```bash
curl http://localhost:3000/api/v1/ens/status
```

Returns the active network, chain ID, and contract addresses so the frontend can confirm it is pointing at the right service.

---

### Top-level `.eth` availability

```bash
curl 'http://localhost:3000/api/v1/ens/availability?name=myname.eth'
```

---

### Registration quote

```bash
curl 'http://localhost:3000/api/v1/ens/register/quote?name=myname.eth&owner=0xWALLET&duration=31536000'
```

Returns `available`, `base`, `premium`, `total`, `minDuration`, `minCommitmentAge`, and `paymentToken`. `duration` defaults to 31536000 seconds (1 year).

---

### Prepare commit transaction

```bash
curl -X POST http://localhost:3000/api/v1/ens/register/prepare-commit \
  -H 'content-type: application/json' \
  -d '{
    "name": "myname.eth",
    "owner": "0xWALLET",
    "from": "0xWALLET",
    "duration": 31536000
  }'
```

Optional inputs:

- `secret`: 32-byte hex. Generated randomly if omitted. **You must store it** for the reveal step.
- `subregistry`: default `0x0000...0000`
- `resolver`: default `0x0000...0000`
- `referrer`: default `0x0000...0000`

Response includes the generated `secret` and the onchain `commitment` hash.

---

### Commitment status

```bash
curl 'http://localhost:3000/api/v1/ens/register/commitment-status?commitment=0x...'
```

Returns `committedAt`, `minCommitmentAge`, `remainingSeconds`, and `canReveal`.

---

### Prepare reveal/register transaction

```bash
curl -X POST http://localhost:3000/api/v1/ens/register/prepare-reveal \
  -H 'content-type: application/json' \
  -d '{
    "name": "myname.eth",
    "owner": "0xWALLET",
    "from": "0xWALLET",
    "duration": 31536000,
    "secret": "0xSECRET_FROM_COMMIT_STEP"
  }'
```

Must use the exact same `name`, `owner`, `duration`, `secret`, `subregistry`, `resolver`, and `referrer` values that were used for commit. The API re-derives the commitment, checks its age, re-checks availability/price, and returns the unsigned `register` transaction.

---

### Parent hierarchy permissions

```bash
curl 'http://localhost:3000/api/v1/ens/children/status?parent=iownthis.eth&from=0xROOT_PARENT_WALLET'
```

Returns the child registry address and whether `from` can create, modify resolver, extend expiry, and revoke children.

---

### Create a child subname

```bash
curl -X POST http://localhost:3000/api/v1/ens/children/create \
  -H 'content-type: application/json' \
  -d '{
    "name": "team.iownthis.eth",
    "from": "0xROOT_PARENT_WALLET"
  }'
```

Optional inputs:

- `expiry`: future Unix timestamp. Defaults to one year from now.
- `resolver`: an existing resolver address.
- `childRegistry`: an already deployed UserRegistry address if this child should become a parent.

There is intentionally no `owner` input. The root-parent wallet always owns the child, and the child role bitmap is `0`.

---

### Modify a child subname

Set the resolver:

```bash
curl -X POST http://localhost:3000/api/v1/ens/children/modify \
  -H 'content-type: application/json' \
  -d '{
    "name": "team.iownthis.eth",
    "from": "0xROOT_PARENT_WALLET",
    "resolver": "0xRESOLVER"
  }'
```

Extend expiry:

```bash
curl -X POST http://localhost:3000/api/v1/ens/children/modify \
  -H 'content-type: application/json' \
  -d '{
    "name": "team.iownthis.eth",
    "from": "0xROOT_PARENT_WALLET",
    "expiry": 1800000000
  }'
```

---

### Revoke a child subname

```bash
curl -X POST http://localhost:3000/api/v1/ens/children/revoke \
  -H 'content-type: application/json' \
  -d '{
    "name": "team.iownthis.eth",
    "from": "0xROOT_PARENT_WALLET"
  }'
```

---

## Frontend integration example

```js
// 1. Quote
const quote = await fetch(
  '/api/v1/ens/register/quote?name=myname.eth&owner=' + account
).then(r => r.json())

// 2. Prepare commit (API generates secret; store it)
const commit = await fetch('/api/v1/ens/register/prepare-commit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'myname.eth', owner: account, from: account }),
}).then(r => r.json())

const commitHash = await walletClient.sendTransaction({
  account,
  to: commit.to,
  data: commit.data,
  value: 0n,
  chain: sepolia,
})

// 3. Poll until revealable
let status
while (true) {
  status = await fetch(
    '/api/v1/ens/register/commitment-status?commitment=' + commit.commitment
  ).then(r => r.json())
  if (status.canReveal) break
  await new Promise(r => setTimeout(r, 2000))
}

// 4. Prepare reveal and send
const reveal = await fetch('/api/v1/ens/register/prepare-reveal', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'myname.eth',
    owner: account,
    from: account,
    secret: commit.secret,
  }),
}).then(r => r.json())

const registerHash = await walletClient.sendTransaction({
  account,
  to: reveal.to,
  data: reveal.data,
  value: 0n,
  chain: sepolia,
})
```

---

## Parent-controlled hierarchy policy

For each root parent such as `iownthis.eth`:

- Children are registered to the same root-parent wallet.
- The child role bitmap is `0`: no separate child owner, no child permissions.
- The root-parent wallet must hold these roles in each child registry:

| Action | Required role |
| --- | --- |
| Create child | `ROLE_REGISTRAR` |
| Change child's resolver | `ROLE_SET_RESOLVER` |
| Extend child's expiry | `ROLE_RENEW` |
| Revoke child | `ROLE_UNREGISTER` |

The API verifies that `from` is the active owner of the top-level parent before returning a transaction.

---

## Notes

- The API is stateless. For top-level registration, the frontend must keep the `secret` returned by `prepare-commit` and pass it back to `prepare-reveal`.
- MockUSDC mint and approve transactions are not provided by this API; build them directly against the token contract (`network.paymentToken`) in the frontend.
- The root parent must already have a child `UserRegistry`/subregistry attached and the root wallet must already hold the required root roles. Deploying and configuring those registries is a separate ENSv2 setup step.
