# Failed-query loop P5 — metrics (close the loop)

Date: 2026-07-06

Surfaces the loop's health so it can be tracked and gated.

## What landed
- `FailedQueryRepository.countByStatus` (in-memory + DB `GROUP BY status`) — accurate counts, not a
  bounded sample.
- `GET /knowledge-spaces/{id}/failed-queries/metrics` -> `{total, byStatus:{...all 6 statuses},
  promotionRate}` where `promotionRate = promoted / total` (share of captured failures that became
  golden questions).

## Deferred (CI / deployment infra, not gateway logic)
- **Eval-harness gating**: running the promoted golden-question set (recall@k) in CI to gate retrieval
  / index changes. This is a CI pipeline concern that consumes the golden questions this loop
  produces; it belongs in the eval scripts, not the request path.
- **Remediation hooks** for retrieval-miss clusters (alias injection, re-chunk, rerank hard-negatives,
  threshold tuning) — these are operator actions validated against the golden set.
The metrics endpoint is the in-gateway deliverable that makes the loop observable (failed-query volume
by status + promotion rate); the harness/remediation build on top with runtime + CI verification.

## Tests
- `failed-query-repository.test.ts` — countByStatus (in-memory grouping + DB GROUP BY mapping).
- `gateway-failed-query.test.ts` — metrics endpoint: total, byStatus, promotionRate after a promotion.
