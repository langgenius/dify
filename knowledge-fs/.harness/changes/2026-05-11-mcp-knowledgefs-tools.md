# MCP KnowledgeFS Tools

## What Changed

- Expanded `createKnowledgeMcpServer()` from `knowledge.fs.ls`, `knowledge.fs.cat`, and `knowledge.search` to the full KnowledgeFS tool set:
  - `knowledge.fs.ls`
  - `knowledge.fs.tree`
  - `knowledge.fs.cat`
  - `knowledge.fs.grep`
  - `knowledge.fs.find`
  - `knowledge.fs.stat`
  - `knowledge.fs.diff`
  - `knowledge.fs.open_node`
  - `knowledge.search`
- Added MCP input schemas for grep, find, diff, and open_node.
- Reused the MCP filesystem list bound for `ls`, `tree`, `grep`, and `find`.
- Extended MCP tests to verify registration, structured tool output, dispatch to injected handlers, unknown-tool rejection, and limit rejection.

## Why

- Phase 2 Sprint 8 requires MCP KnowledgeFS tools so agents can use the same filesystem command semantics through MCP as through the API and CommandRegistry boundaries.

## Performance And Safety Notes

- MCP list-like tools require explicit positive limits.
- `maxFsListLimit` protects list, tree, grep, and find from unbounded result windows.
- MCP handlers stay injected and do not perform direct storage/database work; the actual filesystem behavior remains behind existing repository and CommandRegistry boundaries.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/mcp.test.ts` failed because only `knowledge.fs.ls`, `knowledge.fs.cat`, and `knowledge.search` were registered.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/mcp.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This slice completes MCP KnowledgeFS tools only. MCP retrieval evidence and shell tools remain in the next Sprint 8 MCP slice.
