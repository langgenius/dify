# Knowledge data sources P0 — Source repository + CRUD

Date: 2026-07-03

Foundation for non-upload data sources (website crawl, Notion, …). Stands up the already-defined but
previously-unwired `Source` model so a knowledge space can hold connector-instance records.

## What landed

- **`source-repository.ts`**: `SourceRepository` interface + `createInMemorySourceRepository` and
  `createDatabaseSourceRepository`, mirroring the document-asset repository exactly. Scoped by
  `knowledgeSpaceId` (tenant enforced above via `spaces.get`). Backed by the **existing `sources`
  table** already present in `schema.ts` (id, knowledge_space_id, type, status, name, uri, metadata,
  permission_scope, created_at, updated_at) — no migration change needed.
- **HTTP CRUD** (`source-routes.ts` + `source-handlers.ts` + `source-request-schemas.ts`):
  - `POST /knowledge-spaces/{id}/sources` (create)
  - `GET /knowledge-spaces/{id}/sources` (list, cursor-paginated)
  - `GET|PATCH|DELETE /knowledge-spaces/{id}/sources/{sourceId}`
  Every route resolves `subject.tenantId` and verifies the space via `spaces.get({id, tenantId})`
  before touching the repo (404 otherwise); write/read scope is enforced automatically by method.
- **Wiring**: `sources?` gateway option (default in-memory), `registerSourceHandlers` in
  `createKnowledgeGateway`, and `createDatabaseSourceRepository` in apps/api database-repository mode.
- **`SourceResponseSchema`** added to the OpenAPI response schemas.
- **Fix (also correctness for existing tables):** `permission_scope` is a JSONB column but
  `jsonInsertPlaceholder` did not cast it, so inserts sent JSON text into JSONB without `::jsonb`
  (the same latent gap in the knowledge-node and graph-index repos). Added `permission_scope` to the
  JSON caster.

## Design

A data source is modeled as a `Source` connector-instance (`type: "web"` for crawl, `"connector"`
for Notion/drive); connector specifics live in `metadata` (provider, pluginId, parameters, sync
state) and `uri` (crawl root / workspace). Documents produced by a source will carry
`DocumentAsset.sourceId` + provenance in metadata, reusing the existing ingestion tail unchanged.
Full plan: `.harness/docs/knowledge-data-sources-iteration-plan.md`.

## Tests

`source-repository.test.ts` (in-memory CRUD + scoping + pagination + capacity; database insert
params + row mapping), `gateway-source.test.ts` (end-to-end CRUD via the gateway with tenant
isolation), `database-sql-utils.test.ts` (permission_scope cast).

No JS runtime here — reasoned + unit-test-authored; run `pnpm check`.
