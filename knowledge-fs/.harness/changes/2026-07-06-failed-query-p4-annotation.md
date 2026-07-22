# Failed-query loop P4 — annotation & promotion

Date: 2026-07-06

The human-in-the-loop step: confirm the verdict and route each failed query to its outcome.

## What landed
- `PATCH /knowledge-spaces/{id}/failed-queries/{failedQueryId}` body
  `{verdict: retrieval-miss|coverage-gap|irrelevant, expectedEvidenceIds?, note?}`:
  - **retrieval-miss** -> creates a **golden question** (question = the failed query, the annotated
    `expectedEvidenceIds`, tag `failed-query`, metadata back-link) via the existing
    `GoldenQuestionRepository`; failed query -> `promoted`, annotation records the `goldenQuestionId`.
  - **coverage-gap** -> `annotated` (a known gap; no golden question).
  - **irrelevant** -> `dismissed`.
  Annotation (`{verdict, annotatedBy, annotatedAt, goldenQuestionId?, expectedEvidenceIds?, note?}`)
  is stored under `metadata.annotation`.
- `registerFailedQueryHandlers` now takes the golden-question repo + `now`; the gateway passes its
  existing golden-question repository, so promotion reuses the golden-question infra unchanged.

## Design note
Promotion only happens for retrieval-miss (an answer that exists but was missed) — coverage gaps are
deliberately NOT promoted, so the golden set stays answerable (a golden question implies a correct
answer exists).

## Tests
- `gateway-failed-query.test.ts` — retrieval-miss -> promoted + a golden question with the query and
  expected evidence; coverage-gap -> annotated and irrelevant -> dismissed, both without a golden
  question.
