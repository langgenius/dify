# Extract API KnowledgeFS Types

## Summary

- Extracted KnowledgeFS result contracts and semantic diff contracts from `packages/api/src/index.ts` into `packages/api/src/knowledge-fs-types.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing KnowledgeFS result contracts from drifting back into the gateway.

## Why

- Continues R6 API decomposition after the review checkpoint `5fcec6c`.
- Creates a clean dependency boundary for future MCP server and KnowledgeFS command registry extraction without importing from the gateway entrypoint.

## TDD

- RED: added a code-health guardrail first; it failed because `knowledge-fs-types.ts` did not exist.
- GREEN: moved the contracts, re-exported the module, and reran focused API/MCP/gateway tests.

## Performance Notes

- Type-only extraction; no runtime code, database access, object storage access, queue behavior, or memory retention behavior changed.
- No new clone paths or buffering were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/mcp.test.ts src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 1 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
