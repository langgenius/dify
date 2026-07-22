# KnowledgeFS Diff And Open Node

## What Changed

- Added `diffText(input)` to `@knowledge/compute` and optional `diffTextJson` support on the injected WASM module.
- Added validated `TextDiff` output contracts for merged `equal`, `insert`, and `delete` operations.
- Added authenticated `GET /knowledge-spaces/{id}/fs/diff`.
- Added authenticated `GET /knowledge-spaces/{id}/fs/open_node`.
- Registered `diff` and `open_node` in the KnowledgeFS `CommandRegistry`.
- Added OpenAPI path coverage and API tests for successful diff, citation-ready node fetch, cross-tenant hiding, missing nodes, missing diff paths, and missing compute runtime.

## Why

- Sprint 8 requires version diff and citation-ready node fetches before completing the KnowledgeFS command surface.
- Diff stays behind the TypeScript compute boundary so API code does not depend directly on Rust/WASM details.
- `open_node` uses a single tenant-scoped node lookup and returns source-location citation data that later MCP and shell tools can reuse.

## Verification

- RED:
  - `pnpm --filter @knowledge/compute test -- src/compute.test.ts` failed because `runtime.diffText` was missing.
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `/fs/diff` and `/fs/open_node` were not implemented.
- GREEN focused verification:
  - `pnpm --filter @knowledge/compute test:coverage`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/generation typecheck`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- Diff currently compares already-readable path content in memory and relies on object-storage and WASM diff bounds; very large semantic diff flows should add streaming or pre-windowing before lifting those bounds.
- The next slice should continue with the expanded CommandRegistry/MCP command exposure and should trigger the required 10-commit health review after one more implementation commit.
