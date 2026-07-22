# Extract API Embedding Model Upgrade Workflow

## Summary

- Extracted embedding model upgrade workflow contracts, start/run validation, dense projection build orchestration, evaluation-gated publish/rollback, and queue payload/idempotency helpers from `packages/api/src/index.ts` into `packages/api/src/embedding-model-upgrade-workflow.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing upgrade workflow logic from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Keeps model rollout orchestration separate from HTTP route composition and gateway defaults.

## TDD

- RED: added a code-health guardrail first; it failed because `embedding-model-upgrade-workflow.ts` did not exist.
- GREEN: moved the workflow implementation, re-exported it, and reran focused gateway/code-health tests.

## Performance Notes

- Runtime behavior is unchanged: upgrade run builds dense projections once, evaluates once, then publishes or rolls back one version.
- Start path still uses a deterministic idempotency key and bounded queue payload.
- No new database query patterns, unbounded node scans, object-storage reads, or memory retention paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 8 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
