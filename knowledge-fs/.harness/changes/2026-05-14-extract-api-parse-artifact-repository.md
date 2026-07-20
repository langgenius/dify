# Extract API Parse Artifact Repository Boundary

## Summary

- Extracted parse artifact contracts, bounded memory repository, database-backed repository, row mapper, clone helper, prune validation, and capacity error from `packages/api/src/index.ts` into `packages/api/src/parse-artifact-repository.ts`.
- Added focused tests for clone isolation, bounded in-memory capacity, parameterized SQL writes/reads, and bounded prune deletes.
- Added a code-health guardrail preventing parse artifact repository implementation details from returning to the gateway entry module.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/parse-artifact-repository.test.ts src/code-health.test.ts` failed because `parse-artifact-repository.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/parse-artifact-repository.test.ts src/code-health.test.ts src/gateway.test.ts` passed after extraction and gateway re-export wiring.

## Verification

- Focused typecheck/lint:
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm lint`
- Full verification before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This is implementation commit 9 after review checkpoint `f6ceb51`; the next implementation commit must trigger the mandatory 10-commit health review.
