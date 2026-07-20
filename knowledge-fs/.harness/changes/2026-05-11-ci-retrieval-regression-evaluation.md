# CI Retrieval Regression Evaluation

## Summary

- Added a deterministic retrieval regression gate for CI and local checks.
- The gate compares current recall, citation hit rate, no-answer rate, and question count against checked-in thresholds and optional baseline deltas.
- Wired `pnpm eval:regression` into the root `check` script and GitHub Actions.

## Changes

- Added `createRetrievalRegressionGate()` in `@knowledge/api`.
- Added `packages/api/scripts/retrieval-regression-gate.ts` for CI-friendly report evaluation.
- Added `.harness/evaluation/retrieval-regression-report.json` as the current deterministic baseline/current fixture.
- Exported retrieval regression types and factory from `@knowledge/api`.
- Updated `.github/workflows/ci.yml` with an explicit retrieval regression evaluation step.

## Guardrails

- Threshold and metric inputs are validated before evaluation.
- Failure output is bounded with `maxFailures` to keep CI logs predictable.
- The fixture is static and local; no network, database, or unbounded retrieval work runs during CI.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/retrieval-regression.test.ts` failed because `./retrieval-regression` did not exist.
  - `pnpm eval:regression` failed because the root script did not exist.
- GREEN focused verification:
  - `pnpm --filter @knowledge/api test -- src/retrieval-regression.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm eval:regression`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Commit Tracking

- This slice is review checkpoint `92f4e22` + implementation commit 4 after commit and push.
- The next 10-commit health review is not yet due.
