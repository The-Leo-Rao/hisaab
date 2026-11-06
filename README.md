# Hisaab ENSv2 API

UI-free ENSv2 transaction preparation service with an optional Hisaab invoice/verification module. Every endpoint returns unsigned transaction data; the connected browser wallet signs and broadcasts. This API never receives a private key.

## Run

```bash
npm install
npm run api
```

The API listens on `http://localhost:3000` (override with `PORT=`).

## Network selection

`.env` controls the chain profiles:

```dotenv
VITE_NETWORK=sepolia
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com

# Hisaab / Whitechain configuration
WC_RPC=https://rpc.testnet.whitechain.io
HISAAB_REGISTRY=0x...
HISAAB_RECEIPT=0x...
HISAAB_DEPLOY_BLOCK=0
HISAAB_PUBLIC_BASE=http://localhost:3000
```

Profiles are defined in [`network.mjs`](./network.mjs). To use a private RPC, set the matching override.

Top-level `.eth` registration is only enabled on **Sepolia** because it uses the ENSv2 registrar + MockUSDC test token. Mainnet supports hierarchy management only.

The server prints a startup configuration status for ENS/Sepolia and Whitechain so you can confirm both RPC connections and contract configurations on launch.

---

## Endpoint namespaces

- `/api/v1/ens/*` — ENSv2 transaction preparation
- `/api/v1/hisaab/*` — Hisaab invoice, receipt, verification, and ENS-record setup
- `/verify/*` — Self-contained invoice verification UI

Hisaab routes are handled first; ENS routes act as the fallback.

---

## Prepared transaction shape

All `POST` transaction-building endpoints return an unsigned transaction object:

```json
{
  "action": "ens-register-commit",
  "name": "myname.eth",
  "from": "0x...",
  "to": "0x...",
  "data": "0x...",
  "value": "0x0",
  "chainId": 11155111,
  ...metadata...,
  "metadata": { ... },
  "note": "Unsigned transaction..."
}
```

For wallet submission, select only the top-level `to`, `data`, `value`, and `chainId` fields.

### Metadata compatibility for data writes

Resolver data-write responses include both shapes during migration:

- Canonical field: `metadata.encodedValue`
- Legacy compatibility field: `metadata.value`

Both contain the encoded bytes stored by `setData`. The top-level `value` field is always the transaction value (`0x0` for data writes), so wallet submission is unambiguous.

---

## ENSv2 endpoint reference

### Status / connection check

```bash
curl http://localhost:3000/api/v1/ens/status
```

Returns the active network, chain ID, and contract addresses.

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

### Verify ENS wallet ownership for sign-in

Request a single-use, five-minute challenge:

```bash
curl -X POST http://localhost:3000/api/v1/ens/auth/challenge \
  -H 'content-type: application/json' \
  -d '{"name":"myname.eth","address":"0xWALLET"}'
```

Sign the returned `message`, then submit:

```bash
curl -X POST http://localhost:3000/api/v1/ens/auth/verify \
  -H 'content-type: application/json' \
  -d '{"challengeId":"0xCHALLENGE_ID","signature":"0xSIGNATURE"}'
```

The response has `verified: true` only when the signature recovers to the challenged wallet and that wallet is the current ENSv2 owner.

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

Must use the exact same values from commit.

---

### Parent hierarchy permissions

```bash
curl 'http://localhost:3000/api/v1/ens/children/status?parent=iownthis.eth&from=0xROOT_PARENT_WALLET'
```

---

### List a name's subregistry attachments

```bash
curl 'http://localhost:3000/api/v1/ens/subregistries?parent=team.iownthis.eth'
```

Returns the current subregistry and every non-zero subregistry attached to the name within the searched range, with ordered event history. By default the search covers the last 9,000 blocks (`ENS_LOG_LOOKBACK`), because public RPCs prune older logs; pass `fromBlock=<block-number>` (or set `ENS_FROM_BLOCK`) with an archive RPC to search further back. Queries are split into 50,000-block windows (`ENS_LOG_RANGE`).

---

### Create, modify, and revoke child subnames

Create:

```bash
curl -X POST http://localhost:3000/api/v1/ens/children/create \
  -H 'content-type: application/json' \
  -d '{ "name": "team.iownthis.eth", "from": "0xROOT_PARENT_WALLET" }'
```

Modify resolver or expiry:

```bash
curl -X POST http://localhost:3000/api/v1/ens/children/modify \
  -H 'content-type: application/json' \
  -d '{ "name": "team.iownthis.eth", "from": "0xROOT_PARENT_WALLET", "expiry": 1800000000 }'
```

Revoke:

```bash
curl -X POST http://localhost:3000/api/v1/ens/children/revoke \
  -H 'content-type: application/json' \
  -d '{ "name": "team.iownthis.eth", "from": "0xROOT_PARENT_WALLET" }'
```

---

### Subchild registration and data

Register a subchild:

```bash
curl -X POST http://localhost:3000/api/v1/ens/subchildren/register \
  -H 'content-type: application/json' \
  -d '{
    "parent": "team.iownthis.eth",
    "label": "invoice",
    "from": "0xROOT_PARENT_WALLET",
    "resolver": "0xPERMISSIONED_RESOLVER",
    "data": { "key": "com.hisaab.invoice", "value": "INV-2026-0001", "encoding": "utf8" }
  }'
```

Write data on an existing subchild:

```bash
curl -X POST http://localhost:3000/api/v1/ens/subchildren/set-data \
  -H 'content-type: application/json' \
  -d '{
    "name": "invoice.team.iownthis.eth",
    "from": "0xROOT_PARENT_WALLET",
    "data": { "key": "com.hisaab.invoice", "value": "0xdeadbeef", "encoding": "hex" }
  }'
```

Legacy base-only aliases are retained:

- `POST /api/v1/ens/subchildren/update-data` → same as `set-data`
- `POST /api/v1/ens/subchildren/unregister` → same as `children/revoke`

---

## Hisaab endpoint reference

Hisaab adds invoice verification on Whitechain testnet. Set `HISAAB_REGISTRY` and `HISAAB_RECEIPT` to enable it.

### Sealed invoices (privacy)

Anyone who finds a worker's wallet should not be able to work out who they work for. So:

- Onchain, an invoice has no names. `issuerName` and `clientName` are empty, and `issuerNode` is `keccak256(namehash(ens), invoiceSalt)`, a commitment that can't be matched against a list of subnames.
- The receipt NFT is minted to `0x…dEaD`, not to the issuer, and its card says "Sealed".
- ENS records hold commitments, not wallets or invoice ids: `hisaab.wallet = keccak256(wallet, nameSecret)` and `hisaab.approved` lists `keccak256(invoiceId, invoiceSalt)`. The name secret is `keccak256` of a signature by the issuing wallet, so nothing has to be stored.
- The invoice PDF is a cover page with public facts plus `invoice.enc`: the invoice JSON encrypted with AES-256-GCM, key = HKDF-SHA256 of the invoice key (`HSB<id>-XXXX-…`, 130 random bits), salt = the onchain docHash.
- Without the PDF **and** the key, `/verify/:id` shows only amount, status, dates and tx hashes. With both, the browser decrypts the invoice (the key never reaches this server) and the full checks run.

What this does not hide: the USDT transfer itself is public, so a company paying from a wallet that is publicly its own still links to the worker's wallet.

### Hisaab status

```bash
curl http://localhost:3000/api/v1/hisaab/status
```

### Invoice lookup

```bash
curl http://localhost:3000/api/v1/hisaab/invoice/15
```

### Receipt NFT

```bash
curl http://localhost:3000/api/v1/hisaab/receipt/15
```

### Verify an invoice

Onchain only:

```bash
curl http://localhost:3000/api/v1/hisaab/verify/15
```

With the decrypted document:

```bash
curl -X POST http://localhost:3000/api/v1/hisaab/verify \
  -H 'content-type: application/json' \
  -d '{ "id": 15, "document": { ... } }'
```

With a sealed PDF (`{ "pdf": "<base64>" }`) the response has `needsKey: true` and `sealedDocument`. Decrypt it in the browser with the invoice key, then post the document as above.

### QR codes and PDFs

```bash
curl http://localhost:3000/api/v1/hisaab/qr/15.svg
curl http://localhost:3000/api/v1/hisaab/qr/15.png?size=480
curl http://localhost:3000/api/v1/hisaab/statement/15.pdf
curl -X POST http://localhost:3000/api/v1/hisaab/statement -H 'content-type: application/json' -d '{ "id": 15, "document": { ... } }'
curl -X POST http://localhost:3000/api/v1/hisaab/invoice-pdf -H 'content-type: application/json' -d '{ "id": 15, "sealed": { "v": 1, "alg": "A256GCM-HKDF-SHA256", ... } }'
```

### ENS record setup for Hisaab

Plan and prepare ENS records:

```bash
curl -X POST http://localhost:3000/api/v1/hisaab/ens/records \
  -H 'content-type: application/json' \
  -d '{
    "name": "alice.dev.acme-labs.eth",
    "from": "0xROOT_PARENT_WALLET",
    "kind": "contractor",
    "walletCommitment": "0xKECCAK_OF_WALLET_AND_NAME_SECRET",
    "employer": "acme-labs.eth",
    "role": "Engineer"
  }'
```

For subnames, this endpoint internally calls `/api/v1/ens/subchildren/set-data` for each record.

Grant a client approval role:

```bash
curl -X POST http://localhost:3000/api/v1/hisaab/ens/client-role \
  -H 'content-type: application/json' \
  -d '{ "name": "engagement.ravi-dev.eth", "from": "0xISSUER", "client": "0xCLIENT" }'
```

Approve a specific invoice:

```bash
curl -X POST http://localhost:3000/api/v1/hisaab/ens/approve \
  -H 'content-type: application/json' \
  -d '{ "name": "engagement.ravi-dev.eth", "from": "0xCLIENT", "approval": "0xKECCAK_OF_ID_AND_INVOICE_SALT" }'
```

---

## Testing

```bash
npm run test:unit   # Pure helper tests, no network required
npm run check       # Smoke-test against a running server
npm run test        # Full contract + frontend compatibility matrix (requires .ens-demo.json)
```

---

## Frontend integration example

```js
// 1. Quote
const quote = await fetch(
  '/api/v1/ens/register/quote?name=myname.eth&owner=' + account
).then(r => r.json())

// 2. Prepare commit
const commit = await fetch('/api/v1/ens/register/prepare-commit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'myname.eth', owner: account, from: account }),
}).then(r => r.json())

const commitHash = await walletClient.sendTransaction({
  account,
  to: commit.to,
  data: commit.data,
  value: BigInt(commit.value),
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
  value: BigInt(reveal.value),
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
- The root parent must already have a child `UserRegistry`/subregistry attached and the root wallet must already hold the required root roles.
- ENS/Sepolia and Whitechain are independent configurations; the server reports the status of each at startup.
