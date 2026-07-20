# Extract API Embedding Model Registry

## Summary

- Continued R6 API decomposition by moving `EmbeddingModelRegistry`, bounded in-memory storage, database-backed parameterized SQL, stable keyset pagination, upsert SQL, row mapping, clone helper, and capacity error out of `packages/api/src/index.ts`.
- Exported `cloneEmbeddingModel` from the new module because embedding model upgrade workflow code still needs a defensive output clone without owning registry internals.
- Added a code-health guardrail to prevent embedding model registry implementation details from returning to the gateway file.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/embedding-model-registry.test.ts src/code-health.test.ts` failed because `embedding-model-registry.ts` did not exist.
- GREEN: implemented `packages/api/src/embedding-model-registry.ts`, updated gateway imports, and removed the moved registry implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/embedding-model-registry.test.ts src/code-health.test.ts src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 2 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
