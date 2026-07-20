# Split Document Bulk Gateway Tests

Date: 2026-05-21
Commit message: `Split document bulk gateway tests`
Review checkpoint: `7e5f7e5`
Implementation count since checkpoint: 4 / 10

## Summary

- Continued GF.4 by moving document bulk upload, bulk delete, deletion lifecycle, bulk reindex, and bulk job progress gateway scenarios into `packages/api/src/gateway-document-write.test.ts`.
- Added a code-health guardrail that rejects keeping document bulk gateway tests in the cross-domain `gateway.test.ts` file and keeps that file under a bounded size ceiling.
- Updated `.harness/docs/iteration-plan.md` to mark GF.4 done and queue GF.5 for document compilation gateway test extraction.

## Performance And Safety Notes

- Preserved the existing assertions for bulk file count/byte bounds, storage quota rejection, object cleanup, cascade delete caps, tenant isolation, and durable job progress.
- No production code changed in this slice.
- `gateway.test.ts` is still large; the next split should target document compilation route/job lifecycle tests.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway-document-write.test.ts src/gateway.test.ts` passed.
- `pnpm --filter @knowledge/api typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm lint` passed.
- `cargo test --workspace` passed.
- `git diff --check` passed.
