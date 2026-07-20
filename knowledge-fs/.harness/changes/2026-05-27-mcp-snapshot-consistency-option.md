# MCP Snapshot Consistency Option

## Summary

- Added optional `snapshotFingerprint` inputs to MCP KnowledgeFS read/search/shell tool schemas.
- Added optional `snapshotFingerprint` to workspace snapshot replay input.
- Replay now returns `null` when the requested snapshot fingerprint does not match the stored snapshot.
- Existing calls remain compatible because the new fingerprint is optional.

## TDD Notes

- MCP tests prove read commands pass a valid snapshot fingerprint through to handlers and reject malformed fingerprints.
- MCP replay tests prove callers can pass the snapshot fingerprint through replay.
- Replay service tests prove matching fingerprints replay and mismatched fingerprints do not.

## Verification

- `pnpm exec biome check --write packages/api/src/knowledge-mcp-types.ts packages/api/src/knowledge-mcp-server.ts packages/api/src/agent-workspace-snapshot-schemas.ts packages/api/src/agent-workspace-snapshot.ts packages/api/src/mcp.test.ts packages/api/src/agent-workspace-snapshot.test.ts`
- `pnpm --filter @knowledge/api test -- src/mcp.test.ts src/agent-workspace-snapshot.test.ts`
- `pnpm --filter @knowledge/api typecheck`
