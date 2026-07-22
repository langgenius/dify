# Extract Operation Policy Handlers

## Summary

- Extracted bulk operation summary and retention policy handler registration from `packages/api/src/index.ts` into `packages/api/src/operation-policy-handlers.ts`.
- Preserved tenant-scoped bulk operation lookup, compilation-job availability checks, and tenant/KnowledgeSpace retention policy updates.
- Kept `index.ts` focused on gateway composition while moving operation policy HTTP behavior behind a small registration boundary.

## TDD

- Added a code-health regression test requiring `registerOperationPolicyHandlers` outside the gateway entrypoint.
- Confirmed the test failed while `operation-policy-handlers.ts` did not exist.
- Implemented the handler module and reran focused typecheck/code-health coverage successfully.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This slice is implementation commit 9 after review checkpoint `09193ab`.
- The next implementation commit will trigger the mandatory 10-commit project health review before further feature/refactor work.
