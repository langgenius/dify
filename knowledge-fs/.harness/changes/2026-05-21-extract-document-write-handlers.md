# Extract Document Write Handlers

Date: 2026-05-21
Commit message: `Extract document write handlers`
Review checkpoint: `7e5f7e5`
Implementation count since checkpoint: 2 / 10

## Summary

- Continued the API God File decomposition track by moving document upload, bulk upload, bulk delete, and bulk reindex route registration out of `packages/api/src/index.ts`.
- Added `packages/api/src/document-write-handlers.ts` with an explicit dependency bundle so the gateway file stays focused on composition.
- Added a code-health guardrail that rejects reintroducing document write route registration into `index.ts`.
- Updated `.harness/docs/iteration-plan.md` to mark GF.2 done and queue GF.3 for domain-splitting the large gateway integration test file.

## Performance And Safety Notes

- Preserved existing bounded controls: upload size limits, bulk file/count limits, cascade delete caps, storage quota checks, and bounded cleanup paths.
- Kept tenant-scoped KnowledgeSpace checks before document writes and deletes.
- Kept existing trace spans and object cleanup behavior unchanged.
- This is a mechanical extraction only; no new database reads, object storage reads, or request buffering paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts` passed.
- `pnpm --filter @knowledge/api typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm lint` passed.
- `cargo test --workspace` passed.
- `git diff --check` passed.
