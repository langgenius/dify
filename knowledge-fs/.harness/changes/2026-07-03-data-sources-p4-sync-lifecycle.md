# Knowledge data sources P4 — credential test + idempotent re-sync

Date: 2026-07-03

Adds credential validation and idempotent online-document re-sync.

## What landed

- **Credential test** — `SourceCredentialTester` (gateway option) + `readSourceCredentialConfig`
  (reads `pluginId`/`provider`/`credentials` from any datasource source's metadata).
  `POST /knowledge-spaces/{id}/sources/{sourceId}/test` returns `{valid, error?}`; 501 when no tester.
  apps/api `createApiSourceCredentialTester` dispatches the plugin-daemon `validate_credentials`
  method (data `{provider, credentials}`, response `{result: boolean}`); config/transport errors are
  reported as `{valid:false, error}` rather than thrown.
- **Idempotent online-document re-sync** — the import body's pages gain an optional `lastEditedTime`.
  The import handler keeps a per-source `metadata.imported = { [pageId]: {documentAssetId,
  lastEditedTime} }`; on re-import it **skips** pages whose `lastEditedTime` is unchanged (dify's
  Notion sync semantics), re-fetches changed/new pages, and updates the map. The response gains
  `skipped: string[]` and `metadata.sync.skipped`. Online-document filenames now include the page id
  so materialized documents fold back into the imported state unambiguously.

## Notes / limits

- Changed pages are re-imported as **new** document versions; stale prior versions are not yet
  removed (that needs the document cascade-delete machinery — deferred with source delete-cascade).
- Website re-crawl still re-materializes (content changes over time); the same stale-version note
  applies. Content-hash-based crawl dedup is a follow-up.
- The `imported` map lives in source metadata and grows with the number of imported pages (bounded by
  workspace size).

## Tests

- `source-credential-tester.test.ts` — config reader (defaults, required fields).
- `apps/api source-credential-options.test.ts` — validate_credentials dispatch shape, boolean result,
  invalid-config + dispatch-failure → `{valid:false,error}`.
- `gateway-source.test.ts` — 501/valid credential test; re-sync skips unchanged pages (`skipped:["p1"]`,
  only the edited page re-fetched).

Not run here — run `pnpm check`.
