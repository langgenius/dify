# KnowledgeFS Grep Endpoint

## What Changed

- Added authenticated `GET /knowledge-spaces/{id}/fs/grep`.
- Added `grep` to the KnowledgeFS command registry.
- Added `KnowledgeFsGrepResult` and match response schemas.
- Extended `KnowledgeNodeRepository` with `getMany()` so grep can batch node hydration.
- Implemented scoped grep over physical KnowledgeFS descendants and node text.
- Added tests for tenant-scoped, paginated grep matches and no-match pagination behavior.

## Why

Sprint 8 starts by completing agent-facing KnowledgeFS search. `grep` gives callers a bounded way to inspect exact text matches under a KnowledgeFS physical path without using raw host shell commands.

## Performance Notes

- The endpoint requires explicit `limit`.
- Path enumeration uses existing stable KnowledgePath cursors.
- Node hydration is batched with `getMany()` instead of one repository call per path.
- The search is scoped by tenant-validated KnowledgeSpace id and physical KnowledgeFS path.
- The implementation is bounded by the path repository list limit and optional `timeoutMs`.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`: passed.
- `pnpm --filter @knowledge/api typecheck`: passed.
- `pnpm --filter @knowledge/api test:coverage`: passed.
- `pnpm lint`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- The current in-memory/default command uses bounded path enumeration plus batched node reads. A later database-runtime wiring slice should replace this with a database FTS-backed grep repository for large corpora.
- Snippets currently return the matching node text. Future UX work may add configurable context windows and highlighted ranges.
