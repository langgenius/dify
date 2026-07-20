# Extract API Knowledge MCP Types

## Summary

- Extracted Knowledge MCP tool names, input/output contracts, server options, server interface, and tool summary lists from `packages/api/src/index.ts` into `packages/api/src/knowledge-mcp-types.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing MCP contracts and tool summary constants from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Separates MCP public contracts from gateway route composition and prepares a cleaner follow-up extraction for `createKnowledgeMcpServer`.

## TDD

- RED: added a code-health guardrail first; it failed because `knowledge-mcp-types.ts` did not exist.
- GREEN: moved the MCP contracts/tool summaries, re-exported the module, and reran focused MCP/gateway/code-health tests.

## Performance Notes

- Type and constant extraction only; MCP handler behavior, input bounds, list limits, topK limits, and tool registration behavior are unchanged.
- No database, object storage, queue, or retrieval execution path was changed.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/mcp.test.ts src/gateway.test.ts`
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

- This is implementation commit 2 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
