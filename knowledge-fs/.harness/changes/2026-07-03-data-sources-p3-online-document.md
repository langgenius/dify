# Knowledge data sources P3 — online document (Notion) import

Date: 2026-07-03

Adds the online-document (Notion-like) data source, reusing the P1 datasource transport and the P2b
materializer.

## What landed

- **`online-document-connector.ts`** — `OnlineDocumentConnector` interface (`listPages` +
  `getPageContent`), page/workspace/content types, and `readOnlineDocumentSourceConfig` (a `connector`
  source carrying `pluginId`/`provider`/`datasource`/`credentials`/`parameters` in metadata). Injected
  as a gateway option, like the website-crawl connector.
- **Routes**:
  - `GET  /knowledge-spaces/{id}/sources/{sourceId}/pages` — list authorized pages (workspaces →
    pages). 400 non-connector, 501 no connector, 502 upstream failure.
  - `POST /knowledge-spaces/{id}/sources/{sourceId}/import` — body `{pages:[{pageId,type,workspaceId,name?}]}`;
    fetches each page's content and materializes it as a `text/markdown` document
    (`dataSourceType:"online_document"`, `dataSourceInfo:{pageId,workspaceId,type}`) via the P2b
    materializer. Returns `{documents,failed}`; records `metadata.sync = {imported,failed,requested}`.
    Per-page fetch failures are isolated (reported in `failed`, batch continues).
- **apps/api `createApiOnlineDocumentConnector`** — dispatches `get_online_document_pages`
  (accumulating streamed workspaces/pages, deduped by page id) and `get_online_document_page_content`
  (payload `data.page = {workspace_id,page_id,type}`, last non-empty content wins). Envelope shapes
  mirror dify's `OnlineDocumentInfo`/`OnlineDocumentPage`/`OnlineDocumentPageContent`. Wired into the
  gateway.

## Tests

- `online-document-connector.test.ts` — config reader (connector-type + required metadata).
- `apps/api online-document-options.test.ts` — `listPages` dispatch shape + dedup across envelopes;
  `getPageContent` page-ref payload + last-non-empty content.
- `gateway-source.test.ts` — 501/400 gating; list-then-import end-to-end (2 pages → 2 documents with
  `sourceId`, `metadata.sync`), full path through the in-memory gateway + default markdown parser.

Not run here — run `pnpm check`.
