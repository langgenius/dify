# Phase 1 End-to-End Integration Test

## What Changed

- Added `packages/api/src/phase1-e2e.test.ts`.
- The E2E test covers the Phase 1 critical path:
  - Authenticated PDF upload through the Hono gateway.
  - Parser-produced `ParseArtifact` persistence.
  - WASM runtime chunking through `@knowledge/compute`.
  - `KnowledgeNode` persistence.
  - Dense vector and FTS projection building.
  - Hybrid retrieval with citation source location.
  - Golden-question retrieval evaluation over the retrieved evidence.
- Added `@knowledge/compute` as an API package dev dependency for the integration test.
- Updated dense projection building to pass `inputType: "search_document"` explicitly when embedding document chunks.

## Why

Sprint 4 requires a minimum end-to-end proof that the Phase 1 components can work together before moving into packaging and later production-hardening work. The test locks down the upload -> parse -> chunk -> index -> retrieve -> cite loop without requiring live Docker services or external parser/embedding providers.

## Performance And Safety

- The integration test keeps all repositories bounded.
- Upload uses the existing bounded gateway upload path.
- Chunking passes through the WASM runtime JSON boundary and validates `KnowledgeNodeSchema`.
- Dense indexing embeds all stored nodes in one batch instead of per-node calls.
- Retrieval work remains bounded by explicit `topK` and `limit`.
- The E2E retrieval fixture uses an in-memory projection scan over one bounded fixture and does not introduce a production query path.

## Verification

- RED confirmed with `pnpm --filter @knowledge/api test -- src/phase1-e2e.test.ts`; the new test failed before `@knowledge/compute` was declared in `@knowledge/api`.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/phase1-e2e.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/api typecheck`
- Full verification passed:
  - `pnpm install`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This is an in-process E2E test using fake parser and embedding providers. A live Docker/MinIO/PostgreSQL/Unstructured smoke remains a later environment-dependent gate.
- The test exercises the TypeScript WASM runtime boundary with a deterministic module fixture rather than loading the generated WASM package directly.
- The next Sprint 4 item is standalone Docker image packaging.
