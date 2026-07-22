# Failed-query loop P0 — capture

Date: 2026-07-06

First slice of the failed-query → golden-question loop: capture empty-retrieval queries as
`pending-triage`, off the query hot path. No triage yet.

## What landed

- **`FailedQuery` model** (`models.ts`): `{query, mode, trigger, status, answerTraceId?, metadata,
  knowledgeSpaceId, …}`. `trigger ∈ {no-retrieval-evidence, low-confidence, abstained}` (P0 uses only
  the first); `status` is the full lifecycle machine `{pending-triage → triaged → pending-annotation →
  annotated | dismissed | promoted}`.
- **`FailedQueryRepository`** (in-memory + database), scoped by `knowledgeSpaceId`, with a `status`
  filter on `list`. New **`failed_queries` table** (schema.ts + both rendered migrations, added as the
  last table; `schema.test.ts` table-name list updated). Hand-rendered SQL matches
  `renderCreateTableSql` exactly (validated by `db:migrations:check`).
- **Capture hook**: `createQuerySseResponse` already inspects the generator's done event for the
  answer-trace recorder; added `captureFailedQuery` alongside it. When the structured
  `finishReason === "no-retrieval-evidence"`, it records a `pending-triage` FailedQuery linked to the
  answer trace (`answerTraceId = traceId`). Runs **after** the answer has streamed, wrapped in
  try/catch — a capture failure never breaks the query response. `failedQueryTriggerForFinishReason`
  maps finish reasons to triggers (extended in P1).
- **Read API**: `GET /knowledge-spaces/{id}/failed-queries?status=&cursor=&limit=` (tenant/space
  scoped, bounded, status-filterable).
- **Wiring**: `failedQueries` gateway option (in-memory default) + `FailedQueryRecorder` built and
  threaded into `registerQueryHandlers`; apps/api database repo. `FailedQueryResponseSchema` for
  OpenAPI.

## Design notes

- Trigger is the **structured** `no-retrieval-evidence` finish reason (both generators emit it), not
  text parsing. P1 adds a structured abstention/low-confidence signal for "retrieved junk, no answer".
- Capture is intentionally the only behavior here — relevance triage (retrieval-miss vs coverage-gap
  vs irrelevant) is P2 and runs async against summaries + graph, never the failed chunk retriever.

## Tests

- `failed-query-repository.test.ts` — in-memory CRUD + status filter + pagination + capacity; DB
  insert params + status-filtered select.
- `gateway-failed-query.test.ts` — end-to-end: an empty-retrieval query (fake generator) lands one
  `pending-triage` failed query; an answered query lands none; status filter works.

Not run here — run `pnpm check` (incl. `db:migrations:check`).
