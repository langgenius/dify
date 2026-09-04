# Count Workflow retrievals in Knowledge Space Overview

## Why

The Knowledge Retrieval v2 node called the published retrieval-test operation directly. That path
returned evidence to the Workflow but did not create the durable `query.requested` and AnswerTrace
facts consumed by Knowledge Space Overview, so App/Workflow traffic was absent from query counts
and outcome charts.

## What changed

- Each Knowledge Retrieval v2 node execution now creates one UUID workflow query identity and sends
  it to every selected KnowledgeFS space. KnowledgeFS derives a separate deterministic AnswerTrace
  ID for each space and keeps the workflow query ID in terminal metadata for cross-space linkage.
- Capability v2 retrieval-test requests from a `workflow` caller persist a `query.requested`
  activity and a terminal `query.generate` AnswerTrace under that identity.
- Outcome classification uses only the selected space's published retrieval profile and its
  mode-final score threshold. The Workflow node's optional post-retrieval threshold is not sent to
  KnowledgeFS and does not change the Overview outcome.
- Interactive retrieval tests and legacy Workflow requests without the new business query identity
  remain excluded, preventing manual tests or whole-run transport trace collisions from inflating
  the dashboard.
- Pure-image requests against text-only spaces stay on the existing retrieval path but are excluded
  from Overview because there is no traceable text or resolved image payload to persist.

## Verification

- Test-first regressions failed before the request contract and persistence path were implemented.
- Focused retrieval handler suite: 17 passed, including a shared workflow query across two spaces
  using the real recorder and in-memory repository, plus the text-only pure-image compatibility case.
- KnowledgeFS API full suite: 5,020 passed, 3 skipped.
- Dify Knowledge Retrieval v2 node, KnowledgeFS DTO, and App execution capability: 124 passed.
- KnowledgeFS contract generator: 36 passed; the reviewed subtree/OpenAPI lock was regenerated and
  checked with a temporary Git index.
- `pnpm --filter @knowledge/api typecheck`, `pnpm openapi:export:test`, focused Biome, Ruff, Pyrefly,
  and `git diff --check` passed.
- Browser acceptance ran the `KR v2 Reset verification` Workflow against control space
  `01a0556a-8e43-7e60-8be5-69fe8228f825`. The successful request persisted activity and terminal
  trace `2ecedddd-87c0-4d87-9231-74e81d4a77fd` as `answered`; the 24-hour Overview visibly moved
  from 6 to 7 queries and showed the `dify-app` request in Recent activity.
- The App-threshold boundary has automated coverage: a Workflow threshold-filtered output does not
  send `scoreThreshold` to KnowledgeFS, while the KFS handler classifies from its published profile.
  A second browser attempt with a temporary App threshold of `0.99` reached KFS but the local model
  runtime returned unavailable before a terminal trace; the temporary App setting was restored.
- Final runtime health and queue checks are recorded before handoff.

## Risks and follow-up

- Historical Workflow runs are not backfilled; the new query identity is available only after both
  Dify and KnowledgeFS contain this contract change.
- Failed retrieval execution still leaves the durable request as unanswered, matching the existing
  Overview query lifecycle rather than fabricating a no-evidence terminal result.
