# Knowledge data sources P1 — plugin-daemon datasource transport

Date: 2026-07-03

Adds the transport for Dify-style plugin datasource dispatch to
`@knowledge/plugin-daemon-client`, so website-crawl / Notion / drive connectors can call the
plugin-daemon the same way model calls already do.

## What landed

- `PluginDaemonDatasourceMethod` = `get_website_crawl` | `get_online_document_pages` |
  `get_online_document_page_content` | `online_drive_browse_files` | `online_drive_download_file` |
  `validate_credentials` (dify `api/core/plugin/impl/datasource.py`).
- `PluginDaemonClient.dispatchDatasourceStream(input)` — streams every envelope `data` payload from
  `POST /plugin/{tenant}/dispatch/datasource/{method}`. Critically this path has **no `/invoke`
  suffix**, unlike model ops (`dispatch/{op}/invoke`).
- Refactored the internal dispatch into a shared `streamPath(path, {data, pluginId, userId?,
  signal?})` used by both the op dispatch and the datasource dispatch, so the SSE read, envelope
  unwrap, retries, error mapping, and headers (`X-Api-Key`, `X-Plugin-ID`) are identical. Body is the
  same `{user_id?, data}` envelope.

## Notes

- `dispatchDatasourceStream` is a required interface method (a real capability of the concrete
  client). The three existing mock `PluginDaemonClient`s in the embedding/rerank/llm adapter tests
  gained a no-op stub.
- The response envelope is the same `{code,message,data}` SSE format, so `code != 0` errors (incl.
  nested `PluginInvokeError`) unwrap through the existing path.

## Tests

`plugin-daemon-client/src/index.test.ts`: a datasource dispatch asserts the `dispatch/datasource/
get_website_crawl` URL (no `/invoke`), the `X-Plugin-ID`/`X-Api-Key` headers, the `{user_id, data}`
body, and the streamed page payloads. Not run here — run `pnpm check`.
