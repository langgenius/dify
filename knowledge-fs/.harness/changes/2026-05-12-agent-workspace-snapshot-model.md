# Agent Workspace Snapshot Model

## Summary

- Added a bounded in-memory `AgentWorkspaceSnapshotRepository` for Phase 5 Sprint 17 research agent resumability.
- Captures the workspace context needed to resume or audit long-running research tasks:
  - mounted resources,
  - permission snapshot,
  - index projection fingerprint,
  - source versions,
  - command log,
  - evidence bundles,
  - trace ids,
  - arbitrary bounded metadata.
- Exported the snapshot model from `@knowledge/api`.

## Performance And Safety Notes

- The repository requires explicit upper bounds for snapshots, mounts, source versions, command log entries, and evidence bundles.
- Reads are tenant-scoped by `{ id, tenantId }` and return `null` across tenants.
- Inputs and outputs use clone semantics so callers cannot mutate stored snapshot state.
- Mounts and evidence bundles are validated against existing core schemas instead of introducing duplicate contracts.

## TDD Notes

- RED first:
  - `pnpm --filter @knowledge/api test -- src/agent-workspace-snapshot.test.ts` failed while `./agent-workspace-snapshot` was absent.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/agent-workspace-snapshot.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/agent-workspace-snapshot.ts packages/api/src/agent-workspace-snapshot.test.ts packages/api/src/index.ts`

## Full Verification

- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`
