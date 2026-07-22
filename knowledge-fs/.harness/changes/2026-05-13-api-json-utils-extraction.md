# API JSON Utilities Extraction

## Summary

- Started R6 from the code-review remediation plan by extracting shared API JSON helpers out of the gateway god file.
- Added tests for clone isolation, JSON byte-length safety, and database JSON column shape validation.

## Changes

- Added `packages/api/src/json-utils.ts`.
- Moved `cloneJsonObject`, `jsonByteLength`, `isPlainObject`, `jsonObjectColumn`, `jsonArrayColumn`, and `jsonStringArrayColumn` out of `packages/api/src/index.ts`.
- Exported the utility module from `@knowledge/api`.
- Added a code-health guardrail so JSON DB column helpers do not drift back into the gateway file.

## Verification

- `pnpm --filter @knowledge/api test -- src/json-utils.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- `pnpm check`
- `pnpm build`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Notes

- R6 remains open for further decomposition and embedding clone-path simplification.
