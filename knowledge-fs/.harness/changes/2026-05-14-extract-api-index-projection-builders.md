# Extract API Index Projection Builders

## Summary

- Extracted dense-vector and FTS index projection builder contracts and implementations from `packages/api/src/index.ts` into `packages/api/src/index-projection-builders.ts`.
- Kept `index.ts` as a re-export/wiring surface while preserving the existing gateway behavior.
- Added code-health guardrails to prevent projection builder responsibilities from drifting back into the gateway barrel.

## TDD

- RED: added focused builder tests that imported `./index-projection-builders`, which failed before the module existed.
- GREEN: implemented dense-vector embedding projection building, FTS projection building, projection status validation, clone-isolated persistence results, and direct tests for validation boundaries.

## Verification

- `pnpm --filter @knowledge/api test -- src/index-projection-builders.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/index-projection-builders.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`

## Coverage

- `index-projection-builders.ts`: 96.66% statements, 94.59% branches, 100% functions.

## Review Cadence

- This is implementation commit 3 after review checkpoint `51b0582`.
- Next mandatory 10-commit health review is due after 7 more implementation commits.
