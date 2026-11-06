# Whitechain feedback

We built Hisaab on Whitechain Sepolia (chain 1874): invoices on a registry contract, paid in the test USDT, with a
gasless option and a soulbound receipt NFT that carries an onchain QR code. Most of the work happened against an
anvil fork of the testnet, so some of this is "fork experience" more than "live network experience". Here's what we
ran into, honestly.

## What worked

The chain behaved like any other EVM chain, which is the best compliment we can give it. Solidity 0.8.24, OpenZeppelin
v5 and Foundry all worked with zero changes. `anvil --fork-url https://rpc.testnet.whitechain.io` worked on the first
try, and that turned out to be the most useful thing in the whole stack: we could test against the real test USDT
long before we had anything deployed.

The pleasant surprise was the test USDT itself. It supports EIP-2612 `permit` and EIP-3009, including
`receiveWithAuthorization` with a `bytes signature`. That's what made our gasless flow possible. The payer signs once,
our relayer submits, and the money goes straight from payer to freelancer in a single tx. We ran it end to end on the
fork against the real token and it just worked.

The public RPC was quick and we never saw it drop during reads, `eth_call` or log queries. The chain id, RPC, explorer
and faucet were all easy to find from the prize page.

## Where we got stuck

- **The USDT EIP-712 domain.** There's no `version()` and no `eip712Domain()` on the token, so to sign
  `ReceiveWithAuthorization` we ended up brute-forcing name/version combos against `DOMAIN_SEPARATOR()` until one
  matched. (It's `"Tether USD"` / `"1"`, for anyone reading this.) Took us about an hour. One line in the docs would
  have saved it.
- **Which EIP-3009 functions exist.** We only confirmed the `bytes signature` variant of `receiveWithAuthorization`
  (selector `0x88b7ab63`) by digging through the implementation bytecode behind the proxy. A small table of the token
  functions that are actually supported would help a lot.
- **Hardfork / EVM version.** We couldn't find out whether `PUSH0` / `MCOPY` are supported, so we compiled for `paris`
  to be safe. Not a blocker, just guesswork we'd rather not do.
- **`eth_call` gas cap.** Our receipt NFT builds its SVG and a QR code inside `tokenURI()`, and that costs roughly
  12.5M gas as a view call. It's fine under the usual 50M default, but we didn't know what the RPC's cap actually is,
  and wallets/explorers rendering the NFT depend on that number.
- **Faucet limits.** We weren't sure how much test USDT (and WBT for the relayer) one wallet can pull per day. That
  matters when your demo pays a dozen invoices and needs a funded relayer.
- **Blockscout verification.** The `forge verify-contract` flow wants the trailing `/api/` on the verifier URL. A
  copy-paste Foundry command in the docs (ideally one that covers `via_ir` and constructor args) would be nice.
- **Shared dev keys on the testnet.** Small thing, but while forking we noticed the default Foundry/anvil accounts are
  in active use on the public testnet (account #0 already had nonce 114). Harmless, but a one-line warning in the docs
  ("never use these for a relayer") wouldn't hurt.

## What would have helped

- A short "gasless on Whitechain" recipe: the domain values, a viem `signTypedData` snippet for
  `ReceiveWithAuthorization`, and the nonce + relayer pattern. Gasless is the whole point of the Scale track, and
  every team doing it is going to rediscover the same things.
- `eip712Domain()` on the test USDT, or a note saying why it isn't there.
- A one-page "chain facts" list: hardfork, block time, block gas limit, `eth_call` gas cap, `eth_getLogs` range limit.

## Numbers (fork of Whitechain Sepolia, real test USDT)

| Action | Gas |
|---|---|
| `createInvoice` | ~220k |
| `pay` (including the receipt mint) | ~155k to 187k |
| gasless `payWithAuthorization` | ~210k |
| `tokenURI` with the onchain SVG + QR (view) | ~12.5M |

We also paid 10 contractor invoices from one company wallet: 1 approval plus 10 payments, at about 187k gas each.

Overall, the chain itself never got in our way. Nearly all of our friction was about missing information, not things
being broken.
