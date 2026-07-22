# Document outline DB persistence (completes summaryRelevance)

Date: 2026-07-06

Persists document outlines to the database so the P2 `summaryRelevance` triage signal has real data
in production (previously outlines were in-memory only, so summaries were empty in database mode).

## What landed
- New **`document_outlines` table** (schema.ts + both rendered migrations, added as the last table;
  `schema.test.ts` table-name list updated). Columns mirror `DocumentOutline`
  (id, knowledge_space_id, document_asset_id, parse_artifact_id, artifact_hash, outline_version,
  version, nodes JSON tree, metadata, created_at, updated_at?). `nodes` added to the JSON insert
  caster.
- **`createDatabaseDocumentOutlineRepository`** — implements the repository interface; `create`/`upsert`
  replace any outline for `(document_asset_id, version)` (delete-then-insert) to match the in-memory
  keyed-overwrite semantics without a dialect-specific upsert; `getByDocumentVersion` / `getById` /
  `deleteByDocumentAsset` mirror the parse-artifact repo.
- Wired in `repository-options.ts`; passed into the triage corpus loader in apps so `summaryRelevance`
  now draws on document/section titles + summaries.

## Blast radius (please verify in CI)
- **Outlines are now DB-persisted in database mode.** The gateway previously used the in-memory outline
  default in apps; ingestion's outline upsert + reads now hit the database. This is the intended
  production behavior and additive, but it changes outline persistence for the ingestion/read paths —
  worth a look in review/CI (alongside the graph-index change from the previous commit).

## Follow-up (noted, not done)
- No index on `(document_asset_id, version)` yet — `getByDocumentVersion` scans until one is added;
  fine for correctness (delete-then-insert keeps one row per key), a perf follow-up for large corpora.

## Tests
- `document-outline-repository.test.ts` — in-memory upsert + lookups; DB write (delete-then-insert,
  nodes cast to JSON) + row mapping (nullable updated_at omitted).
- `database-sql-utils.test.ts` — `nodes` JSON cast.
