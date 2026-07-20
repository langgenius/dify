# Extract API Route Classification

## Summary

- Continued R6 API decomposition by moving trace route normalization and rate-limit tool classification into `packages/api/src/route-classification.ts`.
- Added direct tests for high-cardinality path normalization and low-cardinality rate-limit tool names.
- Added a code-health guardrail to keep route classification helpers out of `packages/api/src/index.ts`.

## Why

- Tracing and rate limiting rely on stable, low-cardinality route labels. Keeping that mapping in a focused module makes future route additions easier to review.
- This removes another cross-cutting responsibility from the gateway god file without adding I/O, queries, or runtime state.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/route-classification.test.ts src/code-health.test.ts` failed because `route-classification.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/route-classification.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Risks And Follow-Up

- This slice preserves existing route classifications and adds focused coverage for representative dynamic routes.
- Future route additions should update `route-classification.ts` and its tests together.
