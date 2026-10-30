# HSP integration

What Risklayer implements against HashKey's published Merchant docs, what is our best guess, and how the local gateway differs from the real one.

## Implemented from the published docs

| Piece | Where | Doc rule |
|---|---|---|
| AppAuth HMAC | `src/hsp/signing.ts` | `METHOD\nPATH\nQUERY\nsha256(canonical body)\ntimestamp\nnonce`, HMAC-SHA256 with `app_secret`, headers `X-App-Key`, `X-Timestamp`, `X-Nonce`, `X-Signature` |
| Canonical JSON | `src/verdict/canonical.ts` | keys sorted recursively, compact, RFC 8785 |
| Cart Mandate | `src/hsp/merchant.ts` | `contents.id` (ID1), `details.id` (ID2), x402 `method_data` for USDC on `hashkey` (177) or `hashkey-testnet` (133), USD totals |
| `merchant_authorization` | `src/hsp/signing.ts` | ES256K JWT, `aud: "HashkeyMerchant"`, `cart_hash = sha256(canonical(contents))` |
| Create order | `POST /api/v1/merchant/orders` | returns `payment_request_id`, `payment_url` |
| Payment lookup | `GET /api/v1/merchant/payments?payment_request_id=` | fallback when a webhook is late |
| Webhooks | `POST /v1/hsp/webhook` | `X-Signature: t=,v1=`, HMAC of `t.body`, ±300 s, raw body, idempotent and never moves state backwards |
| Paid states | `src/hsp/merchant.ts` | fulfil on `payment-included`, `payment-safe`, `payment-finalized` |

## Best guess, to confirm with HashKey

The payer side, `POST /api/v1/payment/pay-mandate`, is shown in HashKey's flow diagram but its body is not documented. We send:

```json
{
  "payment_mandate_contents": {
    "payment_mandate_id": "<payment_request_id>",
    "payment_details_id": "<uuid>",
    "payment_details_total": { "label": "Total", "amount": { "currency": "USD", "value": "0.25" } },
    "payment_response": {
      "request_id": "<uuid>",
      "method_name": "https://www.x402.org/",
      "details": {
        "x402Version": 2, "scheme": "exact", "network": "eip155:177",
        "payload": { "signature": "0x…", "authorization": { "from", "to", "value", "validAfter", "validBefore", "nonce" } }
      }
    },
    "merchant_agent": "Risklayer",
    "timestamp": "…"
  },
  "user_authorization": "0x… (EIP-3009 signature)"
}
```

The outer shape matches `AP2PaymentMandate` in HashKey's Go SDK (`types/ap2.go`). The `details` body follows x402 v2 because HSP describes itself as AP2 mandates over x402. The EIP-712 domain for USDC.e on 177 was read from the contract: `name = "Bridged USDC"`, `version = "2"`.

Questions for the HashKey team (Telegram):

1. What is the exact body of `payment_response.details` and `user_authorization` for `pay-mandate`?
2. Is programmatic submission to `pay-mandate` allowed for hackathon demos, or only through the hosted checkout?
3. What is the EIP-712 domain of USDC on HSK testnet (133)?

## The local gateway

`src/hsp/localGateway.ts` is mounted at `/hsp-local` when `HSP_MODE=local`. It is **not HashKey's gateway** and says so in every response. It:

- verifies AppAuth HMAC (timestamp window, nonce reuse) on `/merchant/*`
- verifies the merchant JWT against the merchant public key and the `cart_hash`
- rejects reused `cart_mandate_id` (40001) and duplicate `payment_request_id` (10004)
- on `pay-mandate`, verifies the authorization pays the right address, the right amount, and the right network, is inside its validity window, and recovers to `from`
- with `RELAYER_PRIVATE_KEY`, calls `transferWithAuthorization` on USDC and reports `payment-included` with the real tx hash
- without it, marks the payment `payment-verified` with `simulated: true` and broadcasts nothing
- sends HSP-format webhooks signed with `app_secret`

Switching to real HSP is configuration only: set `HSP_MODE=hsp`, `HSP_APP_KEY`, `HSP_APP_SECRET`, `MERCHANT_KEY_PATH` (the key registered with HashKey), and set the webhook URL in the merchant console to `<PUBLIC_URL>/v1/hsp/webhook`.

## Onboarding request (copy for Telegram)

> Team Risklayer, HSK Horizon (Track 2). Requesting QA merchant onboarding.
> organization_name: Risklayer · default_language: en · service_rate: 0.0000
> supported_chain_tokens: hashkey-testnet/133/USDC, hashkey/177/USDC
> public_key: (output of `npm run keys`)
> Also: could you share the request body for `POST /api/v1/payment/pay-mandate` (`payment_response.details` and `user_authorization`)?
