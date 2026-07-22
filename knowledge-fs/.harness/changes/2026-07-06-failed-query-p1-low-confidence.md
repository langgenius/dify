# Failed-query loop P1 — low-confidence trigger

Date: 2026-07-06

Broadens capture beyond empty retrieval to low-confidence answers, without touching the generators'
answer control flow.

## What landed
- Generators surface the top fused/rerank score as `topScore` in the `retrieval-evidence` done-event
  metadata (additive; both `llm-answer-query-generator` and `hybrid-query-generator`).
- `failedQueryTrigger({finishReason, metadata, lowConfidenceScoreFloor})` replaces the finish-reason-only
  helper: empty retrieval is always captured; a `retrieval-evidence` answer whose `topScore` is below an
  **opt-in** floor is captured as `trigger:"low-confidence"`. Off by default (floor undefined) → zero
  behavior change unless configured.
- The capture stores `metadata:{finishReason, topScore}` on the FailedQuery for later triage context.
- `failedQueryLowConfidenceScoreFloor` gateway option threaded through `registerQueryHandlers` →
  `createQuerySseResponse`.

## Deferred
- Text-based "abstained" detection (model had evidence but declined) — fragile without structured
  model output; the score floor covers the deterministic case.

## Tests
- `failed-query-recorder.test.ts` — trigger matrix (empty always; low-confidence only with a floor and a
  below-floor score; no capture without a floor or without a score).
- `gateway-failed-query.test.ts` — low-confidence captured only with a floor; high-score answers not.
