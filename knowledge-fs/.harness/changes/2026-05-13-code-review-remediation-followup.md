# Code Review Remediation Follow-Up

## Summary

- Continued remediation from `docs/code-review-issues.md` for items that were previously deferred or only partially addressed.
- Kept the fixes test-driven: each behavioral change has focused regression coverage before implementation.

## Fixed Findings

- H1/M5: Extracted trace recorder types and factories from `packages/api/src/index.ts` into `packages/api/src/tracing.ts`, and removed the remaining `context: any` Hono route handler assertions behind a typed local handler boundary.
- M3/L7/L8: Added explicit approximate token counting (`countApproxTokens`) through Rust/WASM and the TypeScript compute runtime, improved Latin long-word approximation, and removed redundant Zod re-parse cloning in the WASM wrapper.
- M8: Added a deterministic `schema_migrations` version tracking table renderer and pending-migration planning API.
- L3: Added `updatedAt` model support for `DocumentAsset`, `ParseArtifact`, `KnowledgeNode`, and `IndexProjection`; regenerated PostgreSQL/TiDB initial migration artifacts with nullable `updated_at` columns for previously missing lifecycle tables.
- L5: Changed the API Docker image to build a bundled JavaScript server, run with `node server.mjs`, and run as the non-root `node` user. Moved `tsx` out of production dependencies.
- L16: Made dry-run research task LLM token pricing configurable instead of hard-coded inside the estimator.
- L21/L24: Added `ObjectStorageAdapter.getObjectStream()` and memory/S3 implementations so callers are no longer forced through all-at-once `getObject()` reads.
- M10: Added regression coverage for nullable metadata in embedding/rerank cache key canonicalization.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts src/migration-file.test.ts`
  - `pnpm --filter @knowledge/adapters test -- src/object-storage.test.ts`
  - `pnpm --filter @knowledge/api test -- src/research-task-planning.test.ts src/code-health.test.ts`
  - `pnpm --filter @knowledge/compute test -- src/compute.test.ts`
  - `pnpm --filter @knowledge/core test -- src/models.test.ts src/platform-adapter.test.ts`
  - `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
  - `pnpm --filter @knowledge/api-app test -- src/server-options.test.ts`
  - `cargo test --workspace`
  - `pnpm --filter @knowledge/api-app build:prod`
  - `pnpm typecheck`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Remaining Larger Tracks

- Full API route/domain decomposition remains ongoing; this slice moved tracing and blocked reintroducing the worst route-handler `any` pattern.
- Provider retry/backoff, structured provider error hierarchy across all provider packages, true incremental SSE streaming, and a live migration runner remain separate hardening slices.
