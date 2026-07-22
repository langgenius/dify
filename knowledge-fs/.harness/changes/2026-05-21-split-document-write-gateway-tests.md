# Split Document Write Gateway Tests

Date: 2026-05-21
Commit message: `Split document write gateway tests`
Review checkpoint: `7e5f7e5`
Implementation count since checkpoint: 3 / 10

## Summary

- Continued the API God File decomposition follow-up by splitting document write gateway integration tests out of `packages/api/src/gateway.test.ts`.
- Added `packages/api/src/gateway-document-write.test.ts` for synchronous upload, trace/artifact readback, WASM-backed node generation, and durable document compilation job upload behavior.
- Added a code-health guardrail that requires the document write gateway scenarios to stay outside the cross-domain gateway test file and keeps the current gateway test file under a bounded line-count ceiling.
- Updated `.harness/docs/iteration-plan.md` to mark GF.3 done and queue GF.4 for bulk document operation test extraction.

## Performance And Safety Notes

- The split preserves existing assertions for bounded upload reads, object-storage write isolation, no object re-read during parsing, trace redaction, tenant-scoped reads, and durable job idempotency.
- No production code changed in this slice.
- The remaining bulk upload/delete/reindex tests still live in `gateway.test.ts`; GF.4 will move those next.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway-document-write.test.ts src/gateway.test.ts` passed.
- `pnpm --filter @knowledge/api typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm lint` passed.
- `cargo test --workspace` passed.
- `git diff --check` passed.
