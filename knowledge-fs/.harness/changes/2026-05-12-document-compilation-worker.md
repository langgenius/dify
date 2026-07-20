# Document Compilation Worker

## What Changed

- Added `createDocumentCompilationWorker()` to consume durable `document.compile` job payloads.
- Worker flow:
  - Loads the tenant-scoped `DocumentAsset`.
  - Reads the raw object from object storage once.
  - Parses with the injected parser.
  - Runs the injected incremental reindexer.
  - Advances compilation stages through `parsed`, `nodes_generated`, and `projection_built`.
  - Marks the asset `parsed` on success or `failed` on error.
- Added tests for successful parse/reindex and parser failure behavior.

## Why It Changed

Uploads had been migrated to durable jobs, but the queued job did not yet have a reusable execution boundary. This slice connects the queued compilation payload to the parser and incremental reindexer while keeping the worker dependency-injected for future Node/Cloudflare runtime wiring.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createDocumentCompilationWorker` did not exist.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- Runtime job polling/lease loop is still a follow-up; this commit adds the worker execution boundary.
- Smoke evaluation remains separate and should gate publication in the next Sprint 11 slice.
- This is implementation commit 2 after reviewed checkpoint `c8f1064`.
