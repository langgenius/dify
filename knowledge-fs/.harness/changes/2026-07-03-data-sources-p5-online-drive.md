# Knowledge data sources P5 — online drive (S3/Drive) import

Date: 2026-07-03

Adds the online-drive data source: browse buckets/files and import selected files as documents,
reusing the P1 transport and P2b materializer.

## What landed

- **Materializer now carries bytes** — `SourceDocumentInput.content: string` became
  `body: Uint8Array`, so binary files (PDF/docx/…) materialize correctly. The crawl and Notion
  callers now encode their markdown to bytes; behavior is otherwise unchanged.
- **`online-drive-connector.ts`** — `OnlineDriveConnector` (`browse` + `download`) + file/bucket
  types + `readOnlineDriveSourceConfig` (a `connector` source). Injected as a gateway option.
- **Routes**:
  - `GET  /knowledge-spaces/{id}/sources/{sourceId}/files?bucket=&prefix=&maxKeys=` — browse
    buckets/files.
  - `POST /knowledge-spaces/{id}/sources/{sourceId}/import-files` — body `{files:[{id,name,bucket?,mimeType?}]}`;
    downloads each file and materializes it (mime type from the request or derived from the filename
    extension; provenance `dataSourceType:"online_drive"`, `dataSourceInfo:{fileId,bucket}`). Per-file
    download failures are isolated. 400 non-connector, 501 no connector, 502 upstream failure.
- **apps/api `createApiOnlineDriveConnector`** — dispatches `online_drive_browse_files`
  (accumulating streamed buckets) and `online_drive_download_file`. Downloaded bytes arrive as
  ToolInvokeMessage `blob` / `blob_chunk` messages; the `blob` field is **base64-decoded** and chunks
  are reassembled in `sequence` order. Wired into the gateway.

## Notes / risks

- **Blob encoding**: the download assumes the daemon base64-encodes blob bytes over JSON (the standard
  JSON-safe binary encoding). If a deployed daemon uses a different encoding, downloaded bytes would be
  wrong — the browse path and everything else are unaffected. This is the one plugin-daemon wire
  detail that could not be pinned from dify's Python models alone.
- The deployed parser must support the imported file's type (the gateway test uses markdown, which the
  default parser handles); unsupported types surface as isolated per-file failures.
- Re-import dedup for drive files is not yet implemented (no per-file change token like Notion's
  lastEditedTime); deferred with the crawl content-hash dedup.

## Tests

- `online-drive-connector.test.ts` — config reader.
- `apps/api online-drive-options.test.ts` — browse dispatch/shape; single base64 blob download;
  out-of-order blob-chunk reassembly.
- `gateway-source.test.ts` — 501/400 gating; browse-then-import end-to-end (file → document with
  `sourceId`, filename preserved).

Not run here — run `pnpm check`.
