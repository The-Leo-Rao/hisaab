# Hisaab

Invoices that prove themselves. A freelancer or contractor bills a client in USDT on Whitechain, the client pays with
or without gas, and anyone the freelancer chooses (a CA, a bank, a visa office) can check the invoice and its payment
from a QR code, without screenshots and without trusting us.

**Live:** https://hisaab-pay.vercel.app · verify API: https://hisaab-api-z89i.onrender.com/api/v1/hisaab/status

Built at ETHGlobal Mumbai for the Whitechain **Operate** and **Scale** tracks, plus ENS (ENSv2 on Sepolia).

## Deployed on Whitechain Sepolia (chain 1874)

| Contract | Address |
|---|---|
| HisaabRegistry | [`0xA9CbE9aeEaa7Cc8981204bc49509ed63F6237986`](https://explorer.testnet.whitechain.io/address/0xA9CbE9aeEaa7Cc8981204bc49509ed63F6237986) (verified) |
| HisaabReceipt (receipt NFT) | [`0x586410a3d9cf1f97231eeac45da4c2d99790fa14`](https://explorer.testnet.whitechain.io/address/0x586410a3d9cf1f97231eeac45da4c2d99790fa14) (verified) |
| Test USDT (official) | [`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`](https://explorer.testnet.whitechain.io/address/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7) |
| Gasless relayer | [`0x6d8D215E7afA60EcAD65AD254198c7e314EfF547`](https://explorer.testnet.whitechain.io/address/0x6d8D215E7afA60EcAD65AD254198c7e314EfF547) |

Deploy block `12409344`. First invoice: [`0xdd89…fc33`](https://explorer.testnet.whitechain.io/tx/0xdd89028912d7b8ee05773397e81b19db657a07fdf48f24aab999b93c0f31fc33).

## Why Whitechain and onchain stablecoins

A bank transfer tells the freelancer that money arrived, but it can't tell a third party *which invoice* it paid, and
the freelancer has to forward statements to prove it. On Whitechain the registry contract itself moves the USDT from
client to freelancer in the same transaction that marks the invoice paid, so the payment and the invoice can't drift
apart. Anyone can re-check it later from the chain. Settlement is final in seconds, costs cents, works across
borders without a correspondent bank, and the client can pay without holding any gas token at all (EIP-3009 on the
test USDT, submitted by our relayer). The money never sits with us: it is not an escrow.

## How it works

```
 Whitechain Sepolia (1874)                          Ethereum Sepolia (ENSv2)
 ┌───────────────────────────────────────┐         ┌──────────────────────────────────────┐
 │ HisaabRegistry  create/pay/refund     │         │ acme-labs.eth ─ priya.dev.acme-labs  │
 │   └ mints HisaabReceipt on full pay   │         │ ravi-dev.eth ─ acme-q4.ravi-dev.eth  │
 │       (card + onchain QR → /verify)   │         │ resolver records hisaab.*            │
 │ test USDT (EIP-3009)                  │         └──────────────────▲───────────────────┘
 └──────────────▲────────────────────────┘                            │
                │ pay / payWithAuthorization                          │ reads
   Next.js app (Vercel): create, pay, invoices, payables, verify      │
     /api/relay  gasless relayer (server key)                         │
     /hisaab-api → verify + PDF API (Render) ─────────────────────────┘
```

1. **Create.** The issuer builds the invoice JSON. Only `keccak256` of it goes onchain, plus a salted commitment
   to the issuer's ENS name, so no names are public. The document travels inside the pay link (`#d=…`), sealed with a
   random invoice key.
2. **Pay.** The client opens the link. The page re-hashes the document against the chain before showing a pay
   button. The client pays with a wallet (`approve` + `pay`) or **without gas**: they sign one EIP-3009 authorization
   and our relayer submits `payWithAuthorization`. USDT goes client → issuer in that same tx.
3. **Receipt.** On full payment the registry mints a receipt NFT whose image (drawn onchain) carries a QR code to
   `/verify/<id>`. It is minted to a dead address so the worker's wallet doesn't collect a public trail of who paid them.
4. **Verify.** Anyone opens `/verify/<id>` and sees the amount, status and payments. With the sealed PDF and the
   invoice key they also see who it is between, checked against ENS (company-issued subnames with expiry and
   revocation, client acknowledgements). They can download a Hisaab Statement PDF.

The contracts have no owner, no admin, no pause and no upgrade path. Refunds and partial refunds go back to the
payer, and a full refund burns the receipt.

## Gasless relayer (Scale)

The relayer is a plain wallet whose key lives only in the server environment (`RELAYER_PK`). It is funded with WBT
from the faucet, and it is the only thing that pays gas for gasless payments. Before it sends anything,
`/api/relay` runs these checks (`HSB_Contract/packages/hisaab-core/src/relay.ts`):

1. the request parses and the authorization expires within 1 hour
2. rate limit: 5 requests per 10 minutes per IP and per payer
3. the invoice exists, is payable, and the amount fits what's still owed
4. the signer is the invoice's named client
5. the payer actually holds the USDT
6. the call is simulated first, and its gas estimate must be under 300k
7. the relayer keeps a floor of 0.01 WBT and stops relaying below it, so the client just pays with their wallet

So a griefer can't drain it with junk: anything that would revert fails simulation and costs the relayer nothing,
and a valid request can only ever pay a real invoice from its real client. Each gasless payment costs about 210k gas.

## Repo layout (branch `HSBdemo`)

| Path | What |
|---|---|
| `app/`, `components/`, `lib/` | Next.js 16 app (Vercel) |
| `HSB_Contract/contracts` | Foundry: `HisaabRegistry`, `HisaabReceipt`, onchain `ReceiptSVG` + `QRCode`, tests |
| `HSB_Contract/packages/hisaab-core` | `@hisaab/core`: invoice hashing, sealing, registry client, gasless signing, relayer |
| branch `HSBens` | ENS + verify/PDF API (`server.mjs`, `hisaab/`), deployed on Render |

## Run it yourself

```bash
git clone -b HSBdemo --recurse-submodules https://github.com/The-Leo-Rao/hisaab.git && cd hisaab
npm install
cp .env.example .env.local   # set HISAAB_NETWORK=whitechain and the addresses above, RELAYER_PK, HISAAB_API_URL
npm run dev                  # http://localhost:3100
```

Contracts: `cd HSB_Contract/contracts && forge test` (35 tests). Deploy:
`DEPLOYER_PK=… VERIFY_BASE=https://<app>/verify/ forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.whitechain.io --broadcast`.
Verify API: `git checkout HSBens && npm ci && npm run api` with `HISAAB_REGISTRY`, `HISAAB_RECEIPT`, `HISAAB_DEPLOY_BLOCK`.

Use MetaMask or Rabby for Whitechain. Phantom can't add custom networks.

## Limitations

- Testnet only. The test USDT is the only token the gasless path supports (it needs EIP-3009).
- The relayer budget is a single hot wallet. In production it would be topped up automatically and rate-limited by
  account, not just by IP.
- Invoice amounts and payment transfers are public onchain. Names and line items are sealed, but the USDT transfer
  from client to worker is still visible.
- The verify/PDF API runs on Render's free plan, so the first request after a quiet spell takes a few seconds.
- ENS identity lives on Ethereum Sepolia (ENSv2 isn't on Whitechain), so the verify page reads two chains.

## Feedback and AI use

Our notes for the Whitechain team are in [`HSB_Contract/WHITECHAIN_FEEDBACK.md`](HSB_Contract/WHITECHAIN_FEEDBACK.md).
We used Claude Code as a pair programmer (contracts, tests, app and deploy scripts). The product and design decisions
are ours, and we reviewed what it wrote.
