# Durable Document Ingestion Migration

## Summary

- Added the first durable ingestion upload path for Phase 3 Sprint 10.
- When a `DocumentCompilationJobStateMachine` is injected, document upload now stores the raw object and pending `DocumentAsset`, starts a durable `document.compile` job, and returns `202 Accepted` with a status URL instead of parsing synchronously on the request path.

## Changes

- Exported a `DocumentCompilationJobStateMachine` interface from `packages/api/src/document-compilation-job.ts`.
- Extended `createKnowledgeGateway()` with an optional `documentCompilationJobs` dependency.
- Added a durable upload branch that:
  - Reuses existing auth, tenant-scoped space lookup, upload bounds, object storage, and asset persistence.
  - Keeps `DocumentAsset.parserStatus` as `pending`.
  - Starts a compact durable compilation job with tenant, space, document asset, and version ids only.
  - Returns `202 Accepted`, `Location`, `statusUrl`, and minimal compilation job status.
- Kept the default gateway path synchronous for current local/dev compatibility when no durable state machine is configured.
- Added an OpenAPI `202` response schema for accepted durable uploads.

## Guardrails

- The request path does not parse bytes or create parse artifacts in durable mode.
- Queue payloads remain compact and do not include raw file bytes, text content, JWTs, or object bodies.
- Existing upload size bounds, object key isolation, SHA-256 metadata, and tenant scoping are preserved.
- If durable job start fails after asset creation, the asset is best-effort marked `failed` and the raw object cleanup path is reused.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because durable upload still returned `201` and parsed synchronously.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- Full verification:
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Commit Tracking

- This slice is implementation commit 3 after reviewed checkpoint `3b9b4d8` once committed and pushed.
- The next 10-commit health review is not yet due.
