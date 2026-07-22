# Knowledge data sources P2a — website crawl connector + crawl endpoint

Date: 2026-07-03

Makes a web `Source` crawlable end-to-end through the plugin-daemon. A configured web source can now
be crawled and its normalized pages returned; server-side materialization of those pages into indexed
documents is the P2b follow-up (see "Deferred" below).

## What landed

- **`WebsiteCrawlConnector`** interface + `CrawledPage`/`WebsiteCrawlResult` types +
  `readWebsiteCrawlSourceConfig` in `@knowledge/api` (daemon-transport-agnostic; the connector is
  injected as a gateway option, like model providers). The config reader pulls `pluginId`,
  `provider`, `datasource`, `credentials`, `parameters` from `Source.metadata` and injects the crawl
  URL from `Source.uri` into the datasource parameters.
- **`POST /knowledge-spaces/{id}/sources/{sourceId}/crawl`** — tenant-checked, web-source-only. Sets
  the source `syncing`, invokes the connector, then marks it `active` (recording
  `metadata.sync = {status,total,completed,pageCount}`) and returns `{status?,total?,completed?,pages[]}`.
  Failures mark the source `error` (with `metadata.sync.error`) and return 502; a missing connector
  returns 501; a non-web source returns 400.
- **`createApiWebsiteCrawlConnector` / `createApiWebsiteCrawlOptions`** (apps/api): dispatches the
  plugin-daemon `get_website_crawl` datasource method (P1 transport), accumulating the streamed
  `web_info_list` (deduped by `source_url`, latest content wins) and the last-reported
  status/total/completed. Wired into `createKnowledgeGateway`. Envelope shape mirrors dify's
  `WebSiteInfo`/`WebSiteInfoDetail`.

## Deferred to P2b — server-side materialization

Turning crawled pages into indexed documents means running the existing ingestion tail
(parse → multimodal → outline → reindex → segments). That tail is a ~150-line inline block in the
upload handler with ~18 injected deps, and `documentCompilationJobs` (the async worker) is **not
wired in apps/api** (default ingestion is synchronous inline). Reusing it cleanly requires extracting
a shared `ingestDocumentSync(...)` from the upload handler — a careful refactor of the critical
ingestion path that must be runtime-verified. Deferred rather than done blind. Until then, the crawl
endpoint returns pages a client can import via the existing upload route (which accepts `sourceId`).

## Tests

- `website-crawl-connector.test.ts` (config reader: url injection, credentials passthrough, non-web +
  missing-metadata rejection).
- `gateway-source.test.ts` (crawl route: 501 no-connector, 400 non-web, happy path → pages + source
  `active` + sync metadata, failure → source `error` + 502).
- `apps/api website-crawl-options.test.ts` (connector: get_website_crawl dispatch shape, page
  accumulation/dedup, ignoring non-result envelopes).

Not run here — run `pnpm check`.
