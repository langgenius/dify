# Queryable Ingestion Local Smoke Query Evidence

## Summary

- Completed QI.4 from the Queryable Ingestion Track.
- Extended `pnpm local:happy-path` to query uploaded content after upload, document read, and parse artifact read.
- Updated README and local infra docs so the source-run smoke is described as a full query evidence check.

## TDD Notes

- Red: script tests required `/queries`, bounded SSE reads, uploaded evidence text, and README query evidence documentation.
- Green: added `requestSse()`, `LOCAL_SMOKE_MAX_SSE_BYTES`, evidence assertions, and query evidence output in the smoke summary.

## Performance Notes

- SSE response reading is explicitly byte bounded and does not use `response.text()`.
- The smoke uses a single query request after ingestion; no polling loop or unbounded fanout was added.

## Verification

- Passed:
  - `node --test scripts/local-happy-path-smoke.test.mjs`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
