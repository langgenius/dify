# Research MCP Tools

## Summary

- Added optional research task MCP tools to `createKnowledgeMcpServer()`:
  - `knowledge.research.plan`
  - `knowledge.research.create`
  - `knowledge.research.get`
  - `knowledge.research.cancel`
- Kept the existing KnowledgeFS/search/shell MCP tool list unchanged when no research handlers are injected.
- Added typed research MCP input contracts and bounded Zod validation.

## Performance And Safety Notes

- Research MCP tools are opt-in through injected handlers, so deployments without research orchestration keep the existing smaller tool surface.
- `knowledge.research.plan` and `knowledge.research.create` enforce explicit `topK` bounds through `maxResearchTopK`.
- Tool schemas are strict and reject caller-supplied `tenantId`, keeping tenant scoping inside the injected server-side handler boundary.
- The MCP layer performs no extra database reads by itself; plan/create/get/cancel handlers can reuse the same tenant-scoped Gateway services.

## TDD Notes

- RED first:
  - `pnpm --filter @knowledge/api test -- src/mcp.test.ts` failed because `knowledge.research.*` tools were not registered.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/mcp.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/mcp.test.ts`

## Full Verification

- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`
