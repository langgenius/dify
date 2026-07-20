# Query-Dependent Virtual Trees

## What Changed

- Added authenticated tenant-scoped query virtual tree APIs:
  - `GET /queries/{traceId}/evidence`
  - `GET /queries/{traceId}/conflicts`
  - `GET /queries/{traceId}/missing`
- Each route resolves the persisted `AnswerTrace`, verifies its `KnowledgeSpace` belongs to the authenticated tenant, and extracts the latest valid `EvidenceBundle` from trace step metadata.
- Evidence, conflict, and missing-evidence items are mapped into `KnowledgeFsListResult` entries with bounded metadata.
- Added cursor/limit pagination and invalid cursor handling for all three virtual lists.
- Added tests for pagination, cross-tenant hiding, empty bundle behavior, fallback ids, and invalid cursors.

## Why

- Sprint 15 needs query-dependent KnowledgeFS views so users can inspect the evidence, conflicts, and missing evidence behind an answer without adding unbounded document scans or new storage tables.
- The implementation reuses existing `AnswerTrace` and `EvidenceBundle` contracts, keeping the feature deterministic and tenant-safe.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because the routes were missing.
  - `pnpm --filter @knowledge/api test:coverage` failed at 89.83% branch coverage before edge-case tests were added.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- Query virtual trees currently read evidence bundle data from trace metadata. If trace payloads grow large, a later iteration should promote query evidence into a dedicated bounded repository.
- Cursor values are offset cursors over a single trace payload, which is stable for immutable answer traces. Dedicated persistence can switch to keyset cursors if these lists become mutable.
