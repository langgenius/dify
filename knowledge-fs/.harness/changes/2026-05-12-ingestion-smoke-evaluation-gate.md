# Ingestion Smoke Evaluation Gate

## Summary

- Added a reusable ingestion smoke evaluation gate for document compilation.
- Wired the durable document compilation worker so compilation can advance from `projection_built` to `smoke_eval_passed` only when smoke retrieval metrics satisfy configured thresholds.
- Preserved the existing no-gate worker behavior for local and tests that do not configure smoke evaluation.

## Behavior

- `createIngestionSmokeEvaluationGate()` wraps an existing `RetrievalEvaluationRunner`.
- The gate requires explicit bounded `limit` and `topK` values.
- Thresholds reuse the existing recall, citation hit rate, and no-answer-rate metrics.
- Failed smoke evaluation returns a deterministic rejection reason; the worker marks the asset `failed`, fails the durable compilation job, and does not advance to publish-ready stages.

## Performance Notes

- The gate performs one bounded evaluation call per compilation job.
- It does not add object storage rereads or per-node follow-up queries.
- Evaluation bounds are validated up front to avoid accidental unbounded golden-question reads or retrieval fanout.

## Tests

- Added red-first API coverage proving the gate was missing.
- Covered passing smoke evaluation advancing to `smoke_eval_passed`.
- Covered failing smoke evaluation blocking compilation and preserving failure state.
- Covered invalid smoke evaluation bounds rejection.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
