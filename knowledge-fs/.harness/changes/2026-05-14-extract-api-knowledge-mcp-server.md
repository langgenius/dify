# Extract API Knowledge MCP Server

## Summary

- Extracted `createKnowledgeMcpServer`, MCP-specific input schemas, bounded MCP limit checks, tool result formatting, and MCP tool registration from `packages/api/src/index.ts` into `packages/api/src/knowledge-mcp-server.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing MCP server construction from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Uses the previously extracted MCP contracts and workspace snapshot schemas so the MCP server module does not import from the gateway entrypoint.

## TDD

- RED: added a code-health guardrail first; it failed because `knowledge-mcp-server.ts` did not exist.
- GREEN: moved MCP server construction and reran focused code-health, MCP, agent research e2e, and gateway tests.

## Performance Notes

- Preserved existing bounded defaults and validation:
  - `maxFsListLimit` default remains `100`.
  - `maxSearchTopK` and `maxResearchTopK` default remain `50`.
  - MCP path, command, query, and research payload schemas retain their size and shape bounds.
- No database, object storage, queue, retrieval, or shell execution behavior changed.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/mcp.test.ts src/agent-research-e2e.test.ts src/gateway.test.ts`
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

- This is implementation commit 4 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
