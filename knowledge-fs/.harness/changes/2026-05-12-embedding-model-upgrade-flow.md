# Embedding Model Upgrade Flow

## Summary

- Added a bounded embedding model upgrade workflow for Sprint 11.
- The workflow can enqueue compact upgrade work and execute the re-embed, evaluate, publish-or-reject path.

## Changes

- Added `createEmbeddingModelUpgradeWorkflow()` to `@knowledge/api`.
- Added start/run contracts for embedding model upgrades.
- `start()` registers the candidate model and enqueues an `embedding-model.upgrade` job payload containing only ids and version numbers.
- `run()` loads the candidate model, rebuilds dense-vector projections with `status: "building"`, runs retrieval evaluation, and publishes or rejects based on thresholds.
- Passing candidates are registered as `active` and publish the candidate projection version.
- Failing candidates roll back the candidate projection version, are registered as `disabled`, and store a bounded rejection reason in metadata.

## Performance Notes

- Re-embedding uses the existing dense projection builder batch path rather than per-node database work.
- Upgrade runs reject node batches above `maxNodes`.
- Nodes must belong to the requested knowledge space before the expensive embedding/evaluation work begins.
- Queue payloads stay compact and do not include node text, vectors, or evaluation artifacts.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- GREEN/full verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
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

## Cadence

- This is implementation commit 8 after reviewed checkpoint `3b9b4d8`.
- The next mandatory 10-commit health review is not yet due.
