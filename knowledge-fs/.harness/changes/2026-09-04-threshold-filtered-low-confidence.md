# Classify threshold-filtered retrieval as low confidence

## Why

When retrieval found candidates but the published score threshold removed all of them, the query
generator correctly returned no chunks with `finishReason: no-retrieval-evidence`. The outcome
classifier treated every such finish reason as `no-evidence`, so the Overview's Low confidence
series was unreachable through this normal UI path even though the trace retained
`metrics.scoreThresholdFilteredCandidates`.

## What changed

- A no-retrieval result is now `low-confidence` when a score threshold was configured and the done
  event reports that at least one candidate was removed by that threshold.
- A query that found no candidates remains `no-evidence`, as does a legacy/custom result that does
  not identify threshold-filtered candidates.
- Existing answered-result classification still compares `topScore` with the same published
  retrieval threshold. No schema, migration, retrieval, or Overview SQL changes were needed.

## Verification

- Test-first regression: the new classifier and durable AnswerTrace cases failed before the
  implementation and passed afterward.
- Focused and retrieval-path regression: 8 files, 132 tests passed.
- API full suite: 5003 passed, 3 skipped, 10 failed across 4 object-storage tests because the
  shared local adapter contained objects written by other tests; the focused affected tests pass
  and none of the failures exercise query outcome classification.
- API TypeScript typecheck, Biome checks for changed source/test files, and `git diff --check`
  passed.
- Browser acceptance against the running local stack: with Fast retrieval and a temporary score
  threshold of `1.0`, a query returned zero chunks and trace
  `642c2338-1c48-4afa-a7b1-905f7cb0eac1` persisted `queryOutcome: low-confidence`,
  `failedQueryTrigger: low-confidence`, and `scoreThresholdFilteredCandidates: 10`. The dataset
  setting was restored to threshold `0.5` with the threshold switch off.
- Final runtime checks passed for the Dify API, KnowledgeFS health/readiness, the generic and
  upgrade Celery workers, and the `dataset`, `knowledge_fs_lifecycle`, and `knowledge_fs_upgrade`
  queues.

## Verification scope notes

- Repository-wide `pnpm check`, `pnpm build`, and `pnpm lint` are not repeated for this isolated
  classifier change; targeted type checking, formatting/lint checks, tests, browser acceptance,
  and runtime health checks cover the changed path.
