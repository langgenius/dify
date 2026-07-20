# Basic Ingestion Trace Hooks

## Summary

- Added lightweight request and ingestion tracing hooks to the Knowledge Gateway.
- Kept tracing injectable and no-op by default so runtime deployments do not need an SDK/exporter yet.
- Added an in-memory trace recorder for deterministic API tests.

## Behavior

- Every gateway request now receives or propagates a `traceId` and returns it in the `x-trace-id` response header.
- HTTP request spans record bounded attributes: method, normalized route, status code, trace id, and tenant id after authentication.
- Document upload ingestion records step spans for space lookup, upload read/hash, object put, asset create, parser parse, artifact create, status update, and cleanup when needed.
- Uploaded `DocumentAsset` metadata and persisted `ParseArtifact` metadata include the request `traceId`.

## Performance And Safety

- Default tracing is no-op and does not allocate persistent runtime state.
- The test recorder records only bounded span metadata.
- Trace attributes intentionally avoid JWTs, uploaded file bytes, object bodies, full document text, filenames, and exception stack traces.
- Ingestion continues to reuse the already bounded uploaded bytes buffer instead of rereading object storage.

## Review Cadence

- This implementation commit is the 10th implementation commit after review checkpoint `9c6714f`.
- Feature iteration must pause after commit and push until a project health review is completed.

## Verification

- RED confirmed with failing API tests for missing `x-trace-id`, missing trace recorder events, and missing trace id metadata.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- Full verification passed:
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
