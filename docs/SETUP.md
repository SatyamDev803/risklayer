# Setup

From a clean machine to the full demo. Each stage works on its own, so you can stop after any of them.

## 0. Requirements

- Node 20 or newer (CI uses 22)
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`), only for the contract
- A GitHub CLI login if you push

## 1. Run it locally with no keys and no money

```bash
git clone https://github.com/SatyamDev803/risklayer && cd risklayer
npm install
SELLER_ADDRESS=0x000000000000000000000000000000000000dEaD ALLOW_SIMULATED_PAYMENTS=1 DEMO_AGENT=1 PORT=4021 npm run server
```

In a second terminal:

```bash
cd web && npm install && cp .env.example .env.local
npx next dev -p 3021
```

Open http://localhost:3021. Market data is live from HSK mainnet. Payments are simulated by the local gateway, and every screen says so.

`ALLOW_SIMULATED_PAYMENTS=1` is what lets simulated payments unlock answers. It is for local runs only. On a public server, leave it off and set `RELAYER_PRIVATE_KEY`, or use real HSP.

Ports: the API defaults to 4021 and the dashboard to 3021. If either is taken, change `PORT` for the API. For the dashboard, change `-p` and `RISKLAYER_URL` in `web/.env.local`.

Try the agent from the command line:

```bash
npm run agent -- --in USDT --out WHSK --amount 60000              # REDUCE, then a fresh check, then ALLOW
npm run agent -- --in USDT --out WHSK --amount 300 --corrupt      # the agent refuses a tampered answer
```

## 2. Keys

```bash
cp .env.example .env
npm run keys >> .env.keys      # read it, then paste the lines into .env
```

`npm run keys` prints fresh seller, agent and relayer private keys. It writes `merchant_private_key.pem` (gitignored, mode 600) and prints the merchant public key for HSP onboarding. It never overwrites an existing PEM.

Never commit `.env`, `.env.keys` or `*.pem`. Share keys with teammates only through a password manager.

### What to share with a teammate

| Share | Secret? | How |
|---|---|---|
| `.env.example` | no | It is in the repo |
| `SELLER_PRIVATE_KEY`, `AGENT_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY` | **yes**, they control funds | Password manager only |
| `merchant_private_key.pem` | **yes**, it signs HSP carts | Password manager only |
| `HSP_APP_KEY` | low | Password manager |
| `HSP_APP_SECRET` | **yes**, it signs merchant calls and verifies webhooks | Password manager only |
| `DEMO_AGENT_TOKEN` | **yes** on public servers | Password manager; set it on both the API and web services |
| `RECEIPTS_ADDRESS`, `SELLER_ADDRESS`, Render URLs | no | Anywhere, including the README |

A teammate who only works on the UI or the rules needs none of the secrets. Step 1 runs with no keys at all.

## 3. Fund the wallets (HSK mainnet, chain 177)

| Wallet | Needs | Why |
|---|---|---|
| Seller | about 2 HSK | Deploy the contract and write receipts |
| Agent | about 20 USDC.e, 30 USDT, 1 HSK | Pay for checks, make the demo swap |
| Relayer | about 1 HSK | Submits EIP-3009 payments in local mode |

Ways to get there:
- **HSK:** buy it on an exchange that withdraws on HashKey Chain, or bridge it from Ethereum.
- **USDC.e:** there is no USDT/USDC.e pool. Swap HSK to WHSK, then use the WHSK/USDC.e pool `0xB580D654cE892181937Aac80EA165950CB7D0E02`.
- **USDT:** use the WHSK/USDT pool `0x4ff515761864e7838b0adb8b5b2b8b7a068905dc`.

## 4. Deploy the receipt contract

```bash
npm run contracts:test
set -a; source .env; set +a
npm run contracts:deploy       # prints "Deployed to: 0x..."
```

Put the deployed address in `.env` as `RECEIPTS_ADDRESS`, then verify on Blockscout:

```bash
npm run contracts:verify
```

Add the address and the Blockscout link to the README under "Contract".

## 5. Real on-chain payments through the local gateway

Set these in `.env`:

```
HSP_MODE=local
PAYMENT_NETWORK=hashkey
RELAYER_PRIVATE_KEY=0x...
RECEIPTS_ADDRESS=0x...
SELLER_PRIVATE_KEY=0x...
AGENT_PRIVATE_KEY=0x...
DEMO_AGENT=1
DEMO_AGENT_TOKEN=<long random string>     # also set on the web service
```

Now each paid check moves real USDC.e from the agent to the seller, and each answer writes a receipt. The answers show the payment and receipt transactions.

## 6. Real HSP

This needs HashKey onboarding. See [HSP.md](HSP.md) for the message to send. Once you have credentials:

```
HSP_MODE=hsp
PAYMENT_NETWORK=hashkey-testnet     # QA first, then hashkey for production
HSP_APP_KEY=...
HSP_APP_SECRET=...
MERCHANT_KEY_PATH=merchant_private_key.pem    # the key whose public half you registered
HSP_PAY_MANDATE_URL=...             # once HashKey confirms the payer endpoint
```

Then set the webhook URL in the HashKey merchant console to `<PUBLIC_URL>/v1/hsp/webhook`. It must be HTTPS, so use the Render URL or an HTTPS tunnel.

## 7. Deploy to Render

`render.yaml` defines two services: `risklayer` (the API) and `risklayer-web` (the dashboard).

1. In Render, create a Blueprint from the repo.
2. Fill every variable marked `sync: false`. For `MERCHANT_PRIVATE_KEY_PEM`, paste the PEM with `\n` for newlines.
3. Set `PUBLIC_URL` on the API to its Render URL.
4. Set `RISKLAYER_URL` and `NEXT_PUBLIC_RISKLAYER_URL` on the web service to the API URL.
5. Check that `https://<api>/health` and `https://<web>/` both respond.

## Environment variables

Every variable is listed with a comment in `.env.example`. These are the ones people trip on:

| Variable | Default | Notes |
|---|---|---|
| `HSP_MODE` | `local` | `hsp` requires app key, secret and merchant key |
| `PAYMENT_NETWORK` | `hashkey-testnet` | `hashkey`, `hashkey-testnet` or `sepolia` (local gateway only). Market data is always mainnet; this is only the payment leg |
| `SELLER_ADDRESS` | from `SELLER_PRIVATE_KEY` | Where payments land |
| `DEMO_AGENT` | `0` | `1` enables the dashboard's paid agent button. It never swaps |
| `DEMO_AGENT_TOKEN` | empty | When set, the agent endpoint needs it. Set the same value on the web service so its proxy can send it |
| `ALLOW_SIMULATED_PAYMENTS` | `0` | `1` lets verified but unbroadcast local payments unlock answers. Local only |
| `DEV_BYPASS` | `0` | `1` adds unpaid `/dev/v1/*` mirrors. Never in production |
| `POLICY_*` | see `config.ts` | Verdict thresholds |
