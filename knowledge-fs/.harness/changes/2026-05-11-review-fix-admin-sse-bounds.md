# Review Fix: Admin SSE Response Bounds

## What Changed

- Added `maxSseBytes` to the Admin shared API client.
- Replaced `response.text()` buffering for query SSE responses with chunked bounded reading.
- Added a test proving oversized SSE streams fail before unbounded retention.

## Why

- The mandatory 10-commit health review after checkpoint `32ed484` found that `streamQuery()` buffered the full SSE response before parsing.
- Long generation streams could otherwise retain unbounded response text in the Admin process.

## Performance And Safety Notes

- Default `maxSseBytes` is `1 MiB`.
- The reader cancels the stream as soon as accumulated bytes exceed the configured limit.
- Existing query input byte bounds remain unchanged.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts` failed because oversized SSE responses were accepted.
- Focused verification:
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts`
  - `pnpm --filter @knowledge/admin typecheck`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This keeps the current array-returning Admin client contract. A later UI slice can expose an async-iterator API for truly incremental rendering while preserving the same byte bound.
