# Extract API Retrieval Text Utilities

## Summary

- Continued R6 API decomposition by moving mixed-language FTS normalization and retrieval query language detection into `packages/api/src/retrieval-text-utils.ts`.
- Kept the public API stable by re-exporting the new module from `packages/api/src/index.ts`.
- Added a code-health guardrail so text normalization helpers do not drift back into the gateway god file.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/retrieval-text-utils.test.ts src/code-health.test.ts` failed because `retrieval-text-utils.ts` did not exist.
- GREEN: implemented the extracted module, imported it into the gateway composition file, and added direct tests for CJK/Latin/mixed/other detection and punctuation-free FTS normalization.

## Verification

- `pnpm --filter @knowledge/api test -- src/retrieval-text-utils.test.ts src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 1 after review checkpoint `51b0582`; the next mandatory health review is due after 9 more implementation commits.
