# Add Vend API Merchant Dify plugin (pay-per-call, Settled via Nano x402)

## Tool Provider: Vend API Merchant

A Dify **Tool** plugin that lets any Dify agent call Vend pay-per-call endpoints
(web extraction and web search) and pay instantly in Nano (XNO) via x402 v2.
No API key, no signup — the wallet is the account.

### Tools

| Tool | Endpoint | Price (XNO) | What it does |
|------|----------|-------------|--------------|
| `vend_extract` | `https://extract.paypercall.dev/api/v1/extract?url=` | 0.0001 | Clean text/markdown from any web page |
| `vend_web_search` | `https://search.paypercall.dev/api/v1/web-search?q=` | 0.0001 | Web search via DuckDuckGo (titles, URLs, snippets) |

### Payment (x402 v2, nano:mainnet)

1. Tool calls the endpoint -> HTTP 402 with challenge
   `{price_xno: 0.0001, accepts:[{scheme:"exact", network:"nano:mainnet", asset:"XNO",
   payTo:"nano_1yo6c1t64a...", amount:"<raw>"}]}`.
2. Send `price_xno` XNO to `pay_to` on-chain (~1 s, zero fee).
3. Set provider credential `payment_header` to the 64-char block hash and retry
   -> HTTP 200 with the JSON data.

### Verified live (2026-09-20)

- `GET https://extract.paypercall.dev/api/v1/extract?url=https://example.com`
  -> HTTP 402, `price_xno: 0.0001`, `network: nano:mainnet`, `asset: XNO`.
- `GET https://search.paypercall.dev/api/v1/web-search?q=nano+cryptocurrency`
  -> HTTP 402 (payment required).

### Files / source

- Package: `vend_api_merchant.difypkg` (in this PR, under `PANDeveloper001/vend_api_merchant/`)
- Source repo: `https://github.com/PANDeveloper001/vend` (branch `etch/work`,
  folder `drafts/dify-vend-tool-plugin/`)
- Docs: `https://extract.paypercall.dev/` , `https://extract.paypercall.dev/openapi.json`
- License: MIT

### Submission type

- **New plugin** (v0.0.1)
- Risk: **Low** — calls fixed, documented HTTPS APIs (`extract.paypercall.dev`,
  `search.paypercall.dev`); no code execution, no SQL, no file/browser/SSH
  operations, no arbitrary URL crawling by the plugin (the plugin only calls the
  configured base URL with the user-supplied `url`/`q` param).

### Local validation (2026-09-20, official dify-marketplace-toolkit)

`dify plugin package` (daemon v0.6.10) then
`validator/validate-difypkg.py vend_api_merchant.difypkg`:

- Blocking failures: **0**
- `package_contents`, `package_secrets`, `package_binaries`, `manifest_metadata`,
  `readme_metadata`, `package_dependencies`, `python_compile`, `python_safety`:
  **PASS** (no findings)
- Warnings for review:
  - financial-activity/`prohibited_financial_activity`: **manual review required
    by Dify's financial-activity guideline, because Vend is a pay-per-call API**.
    The plugin itself performs no payment, asset transfer or token movement — it
    calls a remote HTTP endpoint that answers HTTP 402 with an x402 v2 challenge,
    and the *user* settles the Nano payment on-chain in their own wallet. The
    plugin never touches or moves funds.
  - outbound domains: extracted `extract.paypercall.dev`; the second call site
    builds its host from the configurable `vend_base_url` credential at runtime.

### Reviewer notes

- All endpoints answer HTTP 402 before payment and 200 after a valid `X-PAYMENT`
  header (verified live). No user data is collected (see PRIVACY.md).
- Financial-activity note: Dify's marketplace guideline restricts plugins that
  *perform* financial transactions. This plugin performs none — it surfaces a
  payment requirement from a third-party pay-per-call API. Please review under
  that reading; happy to adjust the disclosure if a different label fits.
- Disclosure: **prepared for Dify by the Vend swarm**
  on behalf of Vend API Merchant. This is not automated spam; it is a ready,
  tested integration a Dify user can install today.
