# Local Smoke Optional Migrations

## Summary

- Added an opt-in `LOCAL_SMOKE_RUN_MIGRATIONS=1` path to `pnpm local:happy-path`.
- The smoke script now runs `pnpm local:db:migrate` before API health, upload, artifact, and query checks when the flag is enabled.
- Updated local startup docs so source-run API/Admin users can validate the durable PostgreSQL path without a separate manual migration step.

## TDD

- Added failing smoke-script assertions first for the migration flag, local migration command, and documentation examples.
- Implemented the bounded command step only after the red test confirmed the gap.

## Performance And Safety

- The migration step is explicit opt-in, so fast local smoke runs keep their existing behavior.
- The smoke script continues to use bounded child-process buffers and bounded HTTP response reads.
- Migrations continue through the existing checked-in SQL command instead of ad hoc database edits.

## Verification

- Passed: `node --test scripts/local-happy-path-smoke.test.mjs`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `cargo test --workspace`
- Passed: `pnpm compose:middleware:config`
- Passed: `git diff --check`
