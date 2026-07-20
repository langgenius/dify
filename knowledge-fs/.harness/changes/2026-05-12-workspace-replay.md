# Workspace Replay

## Summary

- Added bounded agent workspace replay for `AgentWorkspaceSnapshot` command logs.
- Replay compares current command output summaries with the original snapshot summaries and reports matched, changed, and failed commands.

## Key Changes

- Added `createAgentWorkspaceReplayService()` with injected runner, deterministic ID/time hooks, and bounded command/output-summary limits.
- Added `POST /agent-workspace-snapshots/{id}/replay`.
- Added optional MCP tool `knowledge.workspace_snapshot.replay`.
- Gateway defaults to a safe-shell replay runner for KnowledgeFS workspace commands, while tests can inject a deterministic runner.
- Replay responses are tenant scoped and clone isolated.

## Performance Notes

- Replay is explicitly bounded by `maxCommands` and `maxOutputSummaryBytes`.
- Commands run sequentially in snapshot order to keep comparison deterministic and avoid uncontrolled concurrency.
- The default gateway runner uses allowlisted safe-shell command planning; it never executes arbitrary host shell commands.
- Cross-tenant access returns `404` without revealing snapshot existence.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/agent-workspace-snapshot.test.ts` failed because `createAgentWorkspaceReplayService` did not exist.
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because replay injection/route did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/agent-workspace-snapshot.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/agent-workspace-snapshot.ts packages/api/src/agent-workspace-snapshot.test.ts packages/api/src/gateway.test.ts packages/api/src/index.ts packages/api/src/mcp.test.ts`

## Full Verification

- Passed before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This will be implementation commit 3 after reviewed checkpoint `55f83ef`.
