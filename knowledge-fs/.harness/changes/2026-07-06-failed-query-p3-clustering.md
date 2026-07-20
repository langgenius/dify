# Failed-query loop P3 — clustering

Date: 2026-07-06

Groups paraphrases of the same gap so annotation reviews one representative per gap, not 50 rewrites.

## What landed
- `clusterKeyForQuery(query)` — a deterministic canonical key that collapses case, punctuation, word
  order, and stopwords onto content words. Lexical (no embedding index) first cut; a semantic
  clustering can replace it later without changing the read API.
- `clusterFailedQueries(items)` — groups by cluster key, most-frequent first (frequent gaps =
  higher annotation priority); representative = first in group.
- `GET /knowledge-spaces/{id}/failed-queries/clusters?status=&limit=` — lists a bounded window and
  returns `{clusters:[{clusterKey,count,failedQueryIds,representative}]}`.

## Design note
Read-side only — no model/migration/capture change (the key is derived from query text on demand).
This keeps clustering cheap and infra-free; the trade-off is it recomputes per request and is bounded
by the list window, which is fine for triage/annotation volumes.

## Tests
- `failed-query-clustering.test.ts` — key canonicalization (case/punctuation/order/stopwords),
  all-stopword fallback, grouping + frequency ordering.
- `gateway-failed-query.test.ts` — clusters endpoint groups paraphrased captures, most frequent first.
