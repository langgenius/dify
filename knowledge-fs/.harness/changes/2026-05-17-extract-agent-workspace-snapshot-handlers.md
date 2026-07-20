# Extract Agent Workspace Snapshot Handlers

## Summary

- Extracted agent workspace snapshot create, get, and replay handler registration from `packages/api/src/index.ts` into `packages/api/src/agent-workspace-snapshot-handlers.ts`.
- Preserved tenant-scoped KnowledgeSpace validation, permission snapshot capture, trace-aware replay, and replay conflict response behavior.
- Kept the gateway entrypoint moving toward composition-only wiring.

## TDD

- Added a code-health regression test requiring `registerAgentWorkspaceSnapshotHandlers` outside the gateway entrypoint.
- Confirmed the test failed while `agent-workspace-snapshot-handlers.ts` did not exist.
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

- This slice is implementation commit 1 after review checkpoint `710704d`.
- The next mandatory 10-commit project health review is due after 9 more implementation commits.
