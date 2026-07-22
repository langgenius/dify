# MCP Status And FSCK Tools

## Summary

- Added optional MCP operator tools:
  - `knowledge.space.status`
  - `knowledge.fsck`
- Kept the tools optional behind `createKnowledgeMcpServer({ operator })`, matching the existing research and workspace snapshot extension pattern.
- Added `maxOperatorIssues` to cap fsck issue output and return a `truncated` flag when reports exceed the cap.
- Kept fsck read-only; no repair or mutation tool is registered.

## TDD Notes

- MCP tests prove operator tools register only when configured.
- Tests prove status calls pass the KnowledgeSpace id through the bounded schema.
- Tests prove fsck defaults to explicit check inputs, returns summaries, and truncates issue arrays according to `maxOperatorIssues`.

## Verification

- `pnpm exec biome check --write packages/api/src/knowledge-mcp-types.ts packages/api/src/knowledge-mcp-server.ts packages/api/src/mcp.test.ts`
- `pnpm --filter @knowledge/api test -- src/mcp.test.ts`
- `pnpm --filter @knowledge/api typecheck`
