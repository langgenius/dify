# MCP Retrieval And Shell Tools

## What Changed

- Added MCP `knowledge.fetch_evidence` with bounded `topK` validation.
- Added MCP `knowledge.shell.plan` and `knowledge.shell.execute` tools.
- MCP retrieval and shell tools dispatch to injected handlers; MCP remains a schema/guard boundary and does not perform retrieval, storage, or host shell execution directly.
- Extended MCP tests to cover tool registration, structured evidence output, shell plan/execute output, unknown-tool rejection, `topK` bounds, and invalid shell command input.

## Why

- Phase 2 Sprint 8 requires retrieval and shell MCP tools so agents can access evidence and safe shell ergonomics through the same MCP server surface.

## Performance And Safety Notes

- `knowledge.fetch_evidence` reuses `maxSearchTopK` to prevent unbounded evidence fanout through MCP.
- Shell MCP inputs require a non-empty bounded command string.
- Shell execution remains delegated to the SafeShell boundary; no host shell or process execution is introduced.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/mcp.test.ts` failed because `knowledge.fetch_evidence`, `knowledge.shell.plan`, and `knowledge.shell.execute` were not registered.
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

- This slice exposes MCP hooks only. Gateway runtime wiring from authenticated subjects to per-request SafeShell instances can be added when MCP transport/auth integration is finalized.
