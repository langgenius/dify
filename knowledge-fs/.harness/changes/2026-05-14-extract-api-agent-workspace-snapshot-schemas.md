# Extract API Agent Workspace Snapshot Schemas

## Summary

- Extracted agent workspace snapshot request/response, replay, params, and MCP workspace snapshot Zod/OpenAPI schemas from `packages/api/src/index.ts` into `packages/api/src/agent-workspace-snapshot-schemas.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing these schemas from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Creates a shared schema boundary for HTTP routes and future `createKnowledgeMcpServer` extraction without requiring the MCP module to import from the gateway.

## TDD

- RED: added a code-health guardrail first; it failed because `agent-workspace-snapshot-schemas.ts` did not exist.
- GREEN: moved the schemas, re-exported the module, and reran focused code-health, MCP, gateway, and snapshot tests.

## Performance Notes

- Schema-only extraction; request bounds, response shapes, MCP workspace snapshot validation, and route behavior are unchanged.
- No database, object storage, queue, or retrieval execution path was changed.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/mcp.test.ts src/gateway.test.ts src/agent-workspace-snapshot.test.ts`
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

- This is implementation commit 3 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
