# MCP Server Skeleton

## What Changed

- Added `@modelcontextprotocol/sdk` to `@knowledge/api`.
- Added `createKnowledgeMcpServer()` with an SDK-backed `McpServer` instance.
- Registered Phase 1 MCP tools:
  - `knowledge.fs.ls`
  - `knowledge.fs.cat`
  - `knowledge.search`
- Added a deterministic `listTools()` / `callTool()` wrapper for focused tests and future transport wiring.
- Added bounded Zod validation for knowledge space ids, KnowledgeFS paths, list limits, and search `topK`.

## Why

Sprint 4 requires MCP and OpenAPI to be first-class access surfaces. This slice establishes the MCP contract without creating a second data access implementation. Tool calls delegate to injected KnowledgeFS/search handlers so the gateway can reuse existing tenant-scoped, bounded repository paths.

## Verification

- RED confirmed with `pnpm --filter @knowledge/api test -- src/mcp.test.ts`; tests failed because `createKnowledgeMcpServer` did not exist.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/mcp.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/api build`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This slice does not expose an HTTP or stdio MCP transport yet. It only creates the registered server boundary for later runtime wiring.
- `knowledge.search` currently delegates to an injected search handler; later retrieval planner work should map MCP search directly onto the production retrieval runtime.
- MCP auth/session binding is not implemented in this slice. Transport wiring must preserve tenant subject and permission checks.
