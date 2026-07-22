# Failed-query loop P2 — relevance triage

Date: 2026-07-06

The core of the loop: decide WHY a query failed, using signals independent of the chunk retriever
that already failed.

## What landed (packages/api core, fully tested)
- `RelevanceTriage` + `RelevanceTriageSignals` interface: `summaryRelevance` (query vs
  document/section summaries), `graphRelevance` (query entities vs the knowledge graph),
  `answerability` (LLM judge). `createRelevanceTriage` combines them: if neither relevance signal is
  on-topic -> `irrelevant` (answerability is NOT called); otherwise defer to answerability ->
  `retrieval-miss` | `coverage-gap` | `uncertain`.
- `createFailedQueryTriageRunner`: triages a bounded batch of `pending-triage` queries, moving each to
  `dismissed` (irrelevant) or `pending-annotation` (needs a human), recording
  `metadata.triage = {verdict, confidence, signals, triagedAt}`. Per-query failures isolated.
- `POST /knowledge-spaces/{id}/failed-queries/triage?limit=` runs the batch; 501 when no triage
  signals are configured.
- `relevanceTriageSignals` gateway option; the gateway builds the triage + runner when signals are
  injected.

## Deferred (needs new infra + tuning + runtime verification)
The **real apps/api signal implementation** is the one runtime-dependent, tuning-heavy piece and is
intentionally NOT built blind:
- `summaryRelevance` wants a **coarse summary-embedding index** (a new small projection over
  document/section summaries) — separate from the chunk index.
- `answerability` is an **LLM judge**; precision here is make-or-break (an over-eager relevance gate
  floods annotation) and must be calibrated against real data.
- `graphRelevance` needs the graph entity/alias lookup wired.
The mechanism, verdict logic, status machine, runner, and endpoint are complete and tested with fake
signals; wiring real signals is a dedicated, verifiable follow-up.

## Tests
- `relevance-triage.test.ts` — irrelevant short-circuits answerability; on-topic defers to it;
  verdict->status map; runner transitions + records verdict + is idempotent (nothing left pending).
- `gateway-failed-query.test.ts` — triage endpoint: 501 without signals; with fake signals,
  irrelevant -> dismissed and relevant -> pending-annotation with the recorded verdict.
