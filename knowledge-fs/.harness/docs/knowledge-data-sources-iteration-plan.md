# Knowledge Data Sources — Design & Iteration Plan

Date: 2026-07-03

## Goal

Today a knowledge space is populated only by **local file upload**
(`POST /knowledge-spaces/{id}/documents`, multipart). We want to add the other data sources Dify
supports — **website crawl** and **online documents (Notion)** first, with **online drive** as a
stretch — matching Dify's architecture so the two systems stay aligned (knowledge-fs already routes
all model calls through the Dify plugin-daemon).

Reference prototype: `…/datasets/{id}/sources` (a per-dataset "knowledge sources" surface). The
prototype is a client-rendered SPA and could not be scraped; this plan is grounded in Dify's actual
implementation (the authoritative reference) + the current knowledge-fs architecture.

## What Dify does (map)

- **Type taxonomy** (`api/models/enums.py:110`, `api/core/datasource/entities/datasource_entities.py:25`):
  classic `upload_file` / `notion_import` / `website_crawl`; newer plugin datasource kinds
  `online_document` / `online_drive` / `website_crawl` / `local_file`.
- **Newer plugin "datasource" system dispatches through the plugin-daemon**, exactly like model
  calls (`api/core/plugin/impl/datasource.py`):
  - List providers: `GET plugin/{tenant_id}/management/datasources`.
  - Invoke (SSE): `POST plugin/{tenant_id}/dispatch/datasource/{method}` (NOTE: no `/invoke` suffix,
    unlike model ops which are `dispatch/{op}/invoke`), where method ∈
    `get_website_crawl`, `get_online_document_pages`, `get_online_document_page_content`,
    `online_drive_browse_files`, `online_drive_download_file`, `validate_credentials`.
  - Body: `{user_id?, data: {provider, datasource, credentials, datasource_parameters}}`; headers
    `X-Plugin-ID`, `X-Api-Key`, `Content-Type`. Response is the SAME `{code,message,data}` SSE
    envelope knowledge-fs already parses. Credentials are resolved daemon-side.
- **Website crawl config** (`CrawlOptions`): `url`, `limit`, `crawl_sub_pages`, `only_main_content`,
  `includes`, `excludes`, `max_depth`, `use_sitemap`. Providers: firecrawl / watercrawl / jinareader
  (daemon-side plugins). Crawl returns pages (url + content/markdown), polled by job.
- **Notion (online_document)**: list authorized pages (`get_online_document_pages`) → select →
  fetch page content (`get_online_document_page_content`, markdown) → import as documents; re-sync by
  `last_edited_time`.
- **Per-document provenance**: Dify's `Document.data_source_type` (enum) + `data_source_info` (JSON,
  shape per type: `{upload_file_id}` / `{url,provider,job_id,only_main_content,mode}` /
  `{credential_id,notion_workspace_id,notion_page_id,notion_page_icon,type}`).

## Current knowledge-fs seams (map)

- `Source` model ALREADY EXISTS (`packages/core/src/models.ts:418`,
  `type: "upload" | "object-storage" | "connector" | "web"`, `status: active|syncing|error|disabled`,
  `uri`, `name`, `metadata`, `permissionScope`) but has **no repository and no wiring**.
  `DocumentAsset.sourceId?` (`models.ts:443`) is already the provenance hook.
- Ingestion is source-agnostic once you have **bytes + mimeType + filename**: the upload handler
  writes the object, `assets.create(...)`, then parses → multimodal extract → outline → reindexer →
  segments. A crawled/Notion page is just a document whose bytes are its (markdown/HTML) content.
- `ParserAdapter.parse({body, mimeType, filename, …}) → ParseArtifact`; crawled HTML → `native-html`,
  markdown → `native-markdown` — **no new parser needed**.
- `PluginDaemonClient` (`packages/plugin-daemon-client`) already does tenant-scoped SSE dispatch with
  envelope unwrap; `PluginDaemonOp` = llm/rerank/text_embedding/multimodal_embedding. We add a
  datasource dispatch (different path shape).
- Multi-tenancy: `subject.tenantId`, `spaces.get({id, tenantId})`, object keys
  `${tenantId}/spaces/${knowledgeSpaceId}/…` — every new path must preserve this.

## Core design decision

**Reuse the existing document ingestion tail; a data source is just a producer of
`(filename, mimeType, bytes)` + provenance.** New surface area is: (1) a `Source` record + repo,
(2) plugin-daemon datasource transport, (3) a per-source "fetch items → materialize as documents"
orchestrator that calls the SAME asset-create + ingest path with `sourceId` + provenance metadata.
This keeps the risky ingestion pipeline untouched.

Dispatch goes through the **plugin-daemon** (consistent with model calls and Dify's current
architecture); credentials are resolved daemon-side; per-source `pluginId` / `provider` /
`datasource` / `datasource_parameters` are configured on the `Source`.

## Data model (additive, low-risk)

- Use the existing `SourceSchema` as the connector-instance record. Put connector specifics in
  `metadata`: `{ provider, pluginId, datasource, providerType, parameters, sync?: {lastRunAt, lastCursor, error} }`.
  `type` = `"web"` (website_crawl) or `"connector"` (online_document/online_drive). `uri` = the crawl
  root URL / workspace id.
- Add optional provenance to the document, mirroring Dify, WITHOUT breaking existing rows: carry
  `dataSourceType` + `dataSourceInfo` in `DocumentAsset.metadata` (flexible `MetadataSchema`), and set
  `DocumentAsset.sourceId`. (No breaking schema change; a follow-up may promote these to typed fields.)

## Iteration slices (each: tests + its own commit)

### Phase 0 — Source foundation
- `SourceRepository` (in-memory + database) for `SourceSchema`: `create`/`get`/`list`/`update`
  (status + metadata)/`delete`, scoped by `knowledgeSpaceId` (tenant enforced above via `spaces.get`).
- HTTP CRUD: `POST/GET/GET{id}/PATCH{id}/DELETE{id} /knowledge-spaces/{id}/sources`. Wire into
  `createKnowledgeGateway` + apps/api database repositories.
- Accept: create/list/get/update/delete a source; tenant/space scoped; bounded list.

### Phase 1 — Plugin-daemon datasource transport
- Extend `packages/plugin-daemon-client`: `PluginDaemonDatasourceMethod` + `dispatchDatasourceStream`
  (path `/plugin/{tenant}/dispatch/datasource/{method}`, no `/invoke`), reusing the existing
  fetch/SSE/envelope machinery. `apps/api` helper mirroring `plugin-daemon-options.ts`.
- Accept: a stubbed daemon SSE round-trips through `dispatchDatasourceStream` with envelope unwrap +
  error handling; existing model-dispatch tests unchanged.

### Phase 2 — Website crawl source (highest value)
- `createApiWebsiteCrawlConnector`: given a web `Source`, dispatch `get_website_crawl` with
  `datasource_parameters` from the source config; stream crawled pages `{source_url, content,
  title?, description?}`.
- Orchestrator `importSourceDocuments`: for each crawled page → synthesize filename
  (`slug(url).md`), mimeType `text/markdown` (or `text/html`), bytes = content → run the SAME
  asset-create + ingest path (sync or enqueue), with `sourceId` + `metadata.dataSourceType="website_crawl"`
  + `dataSourceInfo={url, provider}`. Dedup by page URL (skip already-imported).
- HTTP: `POST /knowledge-spaces/{id}/sources/{sourceId}/run` (trigger crawl+import), returns a summary
  (imported/skipped/failed counts); source status transitions active→syncing→active/error.
- Accept: stubbed daemon returns 2 pages → 2 documents created + ingested via the existing tail;
  re-run skips unchanged; failure sets source status "error".

### Phase 3 — Online document (Notion)
- `get_online_document_pages` (list authorized pages) → HTTP `GET .../sources/{id}/pages`.
- Import selected pages: `get_online_document_page_content` → markdown → materialize as documents
  (same orchestrator). Provenance `dataSourceInfo={workspaceId, pageId, pageType, lastEditedTime}`.
- Sync: re-run compares `lastEditedTime`; only changed pages re-import; deselected pages' documents
  removed.
- Accept: list pages; import 1 page → 1 document; sync re-imports only changed.

### Phase 4 — Sync & lifecycle
- Source status machine (active/syncing/error/disabled), last-run metadata, re-run/re-sync,
  cascade: deleting a source optionally removes its documents.
- `validate_credentials` dispatch surfaced as a source "test" endpoint.

### Phase 5 — Online drive (stretch)
- `online_drive_browse_files` (list buckets/files) + `online_drive_download_file` (bytes) →
  materialize downloaded files through the normal upload/ingest path (they are real files → existing
  parser handles them).

## Non-goals / deferred
- The full Dify OAuth credential UI + `DatasourceProvider` credential store: credentials are
  daemon-resolved; knowledge-fs stores only a reference (`pluginId`/`provider`/optional
  `credentialsJson` escape hatch), mirroring how model credentials are handled here.
- RAG-pipeline workflow nodes (Dify's pipeline datasource nodes) — out of scope.

## Risk & verification

- **No JS runtime in this environment** — every slice is reasoned + unit-test-authored; the user runs
  `pnpm check`. Because ingestion is reused unchanged and new code is additive (new repo, new routes,
  new transport method), blast radius on existing behavior is low.
- Preserve tenant/space scoping on every new route + object key + daemon dispatch.
- Land slices in order; keep each independently useful and reviewable.
