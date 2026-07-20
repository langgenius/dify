# Split Document Compilation Gateway Tests

Date: 2026-05-21
Commit message: `Split document compilation gateway tests`
Review checkpoint: `7e5f7e5`
Implementation count since checkpoint: 5 / 10

## Summary

- Continued GF.5 by moving document compilation job status and cancellation gateway route tests into `packages/api/src/gateway-document-compilation.test.ts`.
- Added a code-health guardrail that rejects reintroducing the document compilation route test into the cross-domain `gateway.test.ts` file.
- Updated `.harness/docs/iteration-plan.md` to mark GF.5 done and queue GF.6 for the heavier document compilation worker parse/reindex/publication scenarios.

## Performance And Safety Notes

- Preserved tenant isolation, read/write scope checks, cancellation behavior, and job queue cancellation assertions.
- No production code changed in this slice.
- Worker tests remain in `gateway.test.ts` intentionally for the next smaller extraction.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway-document-compilation.test.ts src/gateway.test.ts` passed.
- `pnpm --filter @knowledge/api typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm lint` passed.
- `cargo test --workspace` passed.
- `git diff --check` passed.
