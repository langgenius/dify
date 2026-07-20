# Knowledge data sources P6 — source cascade-delete

Date: 2026-07-03

Deleting a source now removes the documents it produced, with the full per-document deletion cascade.

## What landed

- **Extracted `deleteDocumentAssetCascade`** (`document-cascade-delete.ts`) — the per-document
  deletion cascade (knowledge nodes → index projections → parse artifacts → asset row → stored object
  → lifecycle record, optionally under a delete lease), lifted verbatim out of the bulk-delete
  handler. The bulk-delete handler now calls it; the existing bulk-delete tests guard the move.
- **`listBySource`** on `DocumentAssetRepository` (in-memory + database) — enumerate a source's
  assets, `knowledge_space_id + source_id` scoped, cursor-paginated.
- **`createSourceDocumentDeleter`** (`source-document-deleter.ts`) — enumerates a source's documents
  in bounded batches (re-listing each round since each batch is deleted) and runs the shared cascade
  on each, up to a safety cap. Built once in the gateway from the same deps the bulk-delete uses.
- **`DELETE /knowledge-spaces/{id}/sources/{sourceId}`** gains a `?documents=cascade|keep` query
  (default `cascade`): it deletes the source, then cascade-deletes its documents unless the caller
  passes `documents=keep`.

## Tests

- `document-asset-repository.test.ts` — `listBySource` filters by source, space-scoped.
- `gateway-source.test.ts` — crawl → 2 documents, then `DELETE source` removes both (default), while
  `DELETE source?documents=keep` leaves them. The cascade runs through the real in-memory
  node/projection/artifact/asset/object teardown.
- Existing `gateway.test.ts` bulk-delete tests guard the cascade extraction (unchanged behavior).

## Notes

- The gateway's cascade delete is required-method on the repo now; the one object-literal asset-repo
  mock (in `gateway.test.ts`) gained `listBySource`.
- This closes the "changed pages create stale versions" gap only for source deletion; per-page
  replace-on-change (Notion) and crawl content-hash dedup remain follow-ups.

Not run here — run `pnpm check`.
