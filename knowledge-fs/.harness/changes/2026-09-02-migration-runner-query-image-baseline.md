# Include answer-trace query images in the migration-runner baseline

## What changed

- Added `0049_answer_trace_query_images` to the adapters migration-runner test's ordered migration baseline.
- Kept replay and TiDB preflight fixtures derived from that shared baseline.
- Updated the API migration entrypoint's expected operation sequence for the same migration.
- Removed one redundant blank line from the gateway integration test after its new query-image fixture
  exceeded the existing code-health line budget by one line.

## Why

The new migration was correctly discovered by the runtime, but the explicit test baseline still ended at
`0048_deletion_active_scope_indexes`, so migration-runner tests treated `0049_answer_trace_query_images`
as unexpectedly pending.

## Verification

- `pnpm --filter @knowledge/adapters test -- src/migration-runner.test.ts`: passed.
- `pnpm --filter @knowledge/api-app test -- src/code-health.test.ts`: passed.
- `pnpm --filter @knowledge/api-app test`: passed.
- `git diff --check`: passed.

The repository-wide check, build, lint, and coverage gates were left to CI because this correction only
updates the intentionally explicit migration test fixture.

## Risks and follow-up

- No runtime behavior changes. Future migrations must continue to update this reviewed ordered baseline.
