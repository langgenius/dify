# Review Fix Performance Guardrails

## What Changed

- Added bounded terminal retention for the inline job queue.
- Added cumulative job stats that do not require retaining every completed or failed job.
- Added memory object storage bounds for object count and total retained bytes.
- Added metadata clone isolation for memory object storage.
- Added S3 read-size enforcement for externally oversized objects and streamed bodies.
- Added primary-key tie-breakers to non-unique keyset pagination indexes.
- Added database planner validation requiring unique ordering or an `id` tie-breaker.
- Recorded the 10-commit project health review cadence in `.harness/agents/development-requirements.md`.

## Why

The review at checkpoint commit `9c6714f` found several long-running performance risks: terminal jobs could accumulate without bound, S3 reads could buffer external large objects, memory object storage could grow without count or total-byte limits, and keyset pagination could skip or repeat rows when ordered by non-unique columns.

## TDD Notes

- RED: Added failing inline job queue tests for terminal retention, idempotency cleanup, and invalid retention config.
- RED: Added failing object storage tests for metadata isolation, memory object/byte bounds, and oversized S3 reads.
- RED: Added failing database planner and schema tests for `id` tie-breaker requirements.
- GREEN: Implemented bounded behavior and planner/schema guardrails.

## Performance Notes

- Inline job queues now bound retained terminal history while preserving cumulative stats.
- Memory object storage now has bounded object and byte budgets.
- S3-compatible reads reject oversized objects before or during buffering.
- Database pagination now requires deterministic cursor ordering backed by declared indexes.

## Verification

- `pnpm --filter @knowledge/adapters test -- src/job-queue.test.ts src/object-storage.test.ts src/database.test.ts`: passed.
- `pnpm --filter @knowledge/database test -- src/schema.test.ts src/migration-file.test.ts`: passed.
- `pnpm db:migrations:write`: passed.
- `pnpm db:migrations:check`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- Inline queue retention is an in-memory skeleton; durable queue backends still need real platform implementations.
- Memory object storage remains a bounded fallback and should not replace MinIO/R2 for real deployments.
- The next iteration should add a live MinIO integration smoke test.
