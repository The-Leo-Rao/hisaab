# Hisaab ENS availability API

A small Node.js HTTP API that checks top-level `.eth` name availability on ENSv2 Sepolia. It only reads chain state; it does not register or reserve names.

## Run locally

```bash
npm install
npm start
```

The API listens on `http://localhost:3000` by default. Set `PORT` to choose another port. Set `SEPOLIA_RPC_URL` to use a specific Ethereum Sepolia RPC provider.

## Endpoint

`GET /api/ens/availability?name=myname.eth`

Available response (`200`):

```json
{"name":"myname.eth","available":true,"network":"sepolia"}
```

Unavailable names also return `200`, with `"available": false`. Invalid or missing names return `400`; an RPC problem returns `502`. The endpoint accepts only a single `.eth` name, not subnames.

Example:

```bash
curl 'http://localhost:3000/api/ens/availability?name=myname.eth'
```

Availability is checked against ENSv2's Sepolia ETH Registrar. Actual registrations use a separate commit-reveal flow and payment; this endpoint does neither.
