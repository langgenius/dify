# Extract API Retention Policy Boundary

## Summary

- Extracted retention policy contracts, bounded in-memory repository, and retention cleanup workers from `packages/api/src/index.ts` into `packages/api/src/retention-policy.ts`.
- Added focused retention policy tests covering clone-isolated policy defaults/updates and bounded knowledge-space cleanup worker payload processing.
- Extended the API code-health guardrail so retention policy helper implementations cannot drift back into the gateway entry module.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/retention-policy.test.ts src/code-health.test.ts` failed before `retention-policy.ts` existed.
- GREEN: `pnpm --filter @knowledge/api test -- src/retention-policy.test.ts src/code-health.test.ts src/gateway.test.ts` passed after extraction and gateway re-export wiring.

## Verification

- Focused typecheck: `pnpm --filter @knowledge/api typecheck`
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

- This is implementation commit 6 after review checkpoint `f6ceb51`; the next mandatory 10-commit health review has not been reached.
