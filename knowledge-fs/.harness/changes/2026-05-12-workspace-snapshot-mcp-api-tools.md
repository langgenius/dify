# Workspace Snapshot MCP/API Tools

## Summary

- Added authenticated AgentWorkspaceSnapshot API routes:
  - `POST /agent-workspace-snapshots`
  - `GET /agent-workspace-snapshots/{id}`
- Wired Gateway defaults to a bounded in-memory workspace snapshot repository.
- Added optional MCP tools:
  - `knowledge.workspace_snapshot.create`
  - `knowledge.workspace_snapshot.get`

## Performance And Safety Notes

- Snapshot repository remains explicitly bounded for snapshots, mounts, source versions, command log entries, and evidence bundles.
- API creation checks the tenant-scoped KnowledgeSpace once before persisting a snapshot.
- API input rejects caller-supplied `tenantId` and `permissionSnapshot`; both are derived from the authenticated server-side subject.
- Snapshot reads use `{ id, tenantId }`, so cross-tenant reads return 404.
- MCP snapshot tools are opt-in through injected handlers and are absent when no handler is configured.

## TDD Notes

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test -- src/mcp.test.ts`
  - Failures confirmed missing HTTP routes and missing MCP tools.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts src/mcp.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts packages/api/src/mcp.test.ts`

## Full Verification

- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`
