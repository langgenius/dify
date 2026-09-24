# Privacy

The Vend API Merchant Dify plugin does not collect, store, or log any user data
itself. It only:

- sends the provided `url` / `q` parameter to the Vend endpoint the user configures
  (default `https://extract.paypercall.dev`), and
- attaches the `X-PAYMENT` header the user supplies to fetch paid results.

No analytics, no tracking, no third-party data sharing. Payment and address data
are handled on-chain by the user's own Nano wallet; the plugin only reads back the
HTTP response.

Declared network domains: `extract.paypercall.dev`, `search.paypercall.dev`.
