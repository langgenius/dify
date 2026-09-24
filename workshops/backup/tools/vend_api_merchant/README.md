# Vend API Merchant — Dify Tool Plugin

Pay-per-call web intel and search for Dify agents, settled in Nano (XNO) via x402.
No API key, no signup — the wallet is the account.

## Tools

| Tool | Endpoint | Price (XNO) | What it does |
|------|----------|-------------|--------------|
| `vend_extract` | `https://extract.paypercall.dev/api/v1/extract?url=` | 0.0001 | Clean text/markdown from any web page |
| `vend_web_search` | `https://search.paypercall.dev/api/v1/web-search?q=` | 0.0001 | Web search via DuckDuckGo |

## Payment flow (x402 v2)

1. The tool calls the endpoint without payment -> HTTP 402 with a JSON payment challenge
   (`accepts: [{scheme:"exact", network:"nano:mainnet", asset:"XNO", payTo:"nano_1yo6c1t6...", amount:"<raw>"}`, `price_xno: 0.0001`).
2. The agent/user sends `price_xno` XNO to `pay_to` on-chain (~1s, zero fee).
3. Paste the 64-char block hash into the provider credential `payment_header`
   (the `X-PAYMENT` header) and retry -> HTTP 200 with the JSON result.

## Verified against the live endpoint (2026-09-20)

- `GET /api/v1/extract?url=https://example.com` -> HTTP 402, `price_xno: 0.0001`,
  `accepts[0].network: nano:mainnet`, `asset: XNO` (quoted live this run).
- `GET /api/v1/web-search?q=nano+cryptocurrency` -> HTTP 402 (payment required).

## Source

- Plugin source: this directory (`drafts/dify-vend-tool-plugin/` in `vend` repo, branch `etch/work`)
- Backend: https://github.com/PANDeveloper001/vend (Vend API Merchant)
- Docs: https://extract.paypercall.dev/ , https://extract.paypercall.dev/openapi.json

## Reproduce locally

```bash
pip install dify-plugin httpx
# provider credential: leave base URL default; paste a block hash into payment_header to get data
```

## Marketplace submission (pending reviewer, not yet listed)

This is a **draft**. Publishing to marketplace.dify.ai requires a packaged `.difypkg`
(via the `dify` CLI) submitted as a PR to `langgenius/dify-plugins`. Not yet submitted.
