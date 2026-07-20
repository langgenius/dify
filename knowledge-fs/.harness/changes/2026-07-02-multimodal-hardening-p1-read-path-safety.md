# Multimodal hardening P1 — read-path safety

Date: 2026-07-02

Closes audit findings on the multimodal asset read route (`document-read-handlers.ts`).

## S1.1 — Stored-XSS hardening on the asset binary response

The route served asset bytes with the stored, uploader-controlled `assetRef.contentType` and no
`nosniff`/`Content-Disposition`/CSP, and the extractor accepts `image/svg+xml`. An embedded SVG
with `<script>` therefore rendered inline on the API origin.

`buildAssetResponseHeaders` now:
- serves only an allowlist of inline-safe image types (png/jpeg/gif/webp) with their content type and
  `Content-Disposition: inline`;
- serves everything else (svg, html, unknown) as `application/octet-stream` +
  `Content-Disposition: attachment` — never the stored type;
- always adds `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none';
  sandbox`.

## S1.2 — Asset read byte cap

The route buffered the entire object into memory with no size guard. It now rejects with 413 when
`headObject().sizeBytes` (and, defensively, the read body length) exceeds
`assetMaxReadBytes` (option, default 25 MB) before/after `getObject`. Route schema gains a 413
response.

## S1.3 — Own-property variant lookup

`variants[query.variant]` used a bracket lookup that returned prototype objects for
`__proto__`/`constructor`; it now guards with `Object.hasOwn`.

## Tests

- `document-read-handlers.test.ts` (new): unit tests for allowlisted-inline, svg/html/unknown →
  attachment+octet-stream, casing normalization, variant header.
- `gateway-document-write.test.ts`: the existing tenant-scoped asset test now also asserts
  `content-disposition: inline`, `nosniff`, and the CSP header.

Reasoned-verified only (no Node runtime here). Run `pnpm --filter @knowledge/api test` + `pnpm check`.
