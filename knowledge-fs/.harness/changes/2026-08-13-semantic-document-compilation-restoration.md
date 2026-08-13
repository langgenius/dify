# Semantic Document Compilation Restoration

## Summary

Restores the missing reasoning-model semantic compilation stage between parsing and indexing.
Parser output is normalized without mutating the stored parse artifact, the configured reasoning
model selects contiguous source ranges, and the service materializes authoritative chunk text from
those source elements. Outline, summaries, PageIndex, dense/full-text projections, and Graph facts
now share one immutable publication generation.

## Behavior and invariants

- Untrusted Unstructured `Title`/`Heading` classifications no longer become compulsory chunk
  boundaries; explicit parser hierarchy remains trusted.
- Semantic requests are bounded by elements, windows, response bytes, chunks, entities, and
  relations. Tables/images remain atomic at model-window boundaries.
- Model output supplies source ranges and metadata, never authoritative document text. Coverage,
  order, terminal model identity, and Unicode grapheme limits fail closed.
- A compact immutable generation receipt makes completed retries provider-free and detects
  conflicting or corrupt replay.
- Node rows and their receipt are persisted in one database transaction; all-excluded generations
  are represented explicitly.
- New semantic compilations materialize quality-controlled joint Graph facts synchronously before
  candidate publication. Graph facts remain generation- and source-node-scoped.
- Reasoning-profile migrations rebuild semantic nodes, outline, paths, PageIndex, search
  projections, and Graph together. Embedding-only migrations clone the exact semantic node
  generation and rerun only the affected projections/Graph materialization without another LLM
  segmentation call.
- Existing published generations remain readable until candidate evaluation and publication CAS
  succeed. No semantic profile silently falls back to legacy fixed-size chunking.

## Data model

- Adds paired PostgreSQL/TiDB migration `0043_semantic_generation_receipts`.
- Adds the schema/catalog entry, migration registry artifacts, migration runner expectations, and
  receipt repository transaction support.

## Product diagnostics

- Document compilation continues to expose parsed, outline-built, nodes-generated,
  projection-built, evaluated, and published checkpoints.
- Existing document-list failure hover behavior shows the actionable failure reason directly and
  keeps the trace id as secondary support information.
- Document outlines are derived from semantic-node section paths and semantic summaries rather
  than parser newline rendering.

## Rollout

1. Apply migration 0043 before starting the new API/workers.
2. Deploy API and worker runtime together; missing semantic/Graph runtime dependencies fail startup.
3. Canary new imports and compare chunk coherence, outline localization, retrieval recall, provider
   calls, latency, and Graph provenance.
4. Rebuild existing documents through normal reindex/profile-migration candidate publication.
5. Drill publication-head rollback before removing the legacy read path.

The rollout is now executable through guarded, bounded commands:

- `semantic:rollout:static` verifies migration 0043 and its generated registry without network IO.
- `semantic:rollout:preflight` reads health, settings, documents, and failed reindex baselines.
- `semantic:rollout:canary` accepts only explicit document asset ids, polls every accepted job, and
  verifies non-empty semantic outline provenance.
- `semantic:rollout:backfill` uses the existing bounded whole-space bulk reindex path.
- `semantic:rollout:rollback` submits a CAS-bound immutable document revision rollback and verifies
  that the requested revision becomes active.
- Canary, backfill, and rollback require `SEMANTIC_ROLLOUT_APPLY=1` plus an exact
  `semantic:<mode>:<space-id>` confirmation. The script never applies database DDL.

## Verification

Passed locally on 2026-08-13:

- `pnpm --dir knowledge-fs check`, including workspace typechecks/tests, OpenAPI and capability
  exports, migration checks, retrieval/phase-4 evaluations, Swagger checks, workflow gates, and
  static Docker/Compose smoke checks.
- `pnpm --dir knowledge-fs build` (12/12 tasks).
- `pnpm --dir knowledge-fs test` (22/22 tasks); the API suite passed 4,475 tests with 3 skipped,
  API-app passed 252 tests, database passed 114 tests, and adapters passed 105 tests.
- `pnpm --dir knowledge-fs semantic:rollout:test` passed all 5 guarded rollout tests, including
  static migration evidence, mutation confirmation, bounded preflight, explicit-document canary,
  and package-script registration.
- Retrieval evaluation: recall 0.890, citation 0.880, no-answer rate 0.060, answer accuracy 0.890,
  and faithfulness 0.910. Phase-4 regression deltas remained within their configured bounds.
- Repository CI coverage task passed. The semantic compilation change set now reports 90.01%
  branch coverage. An additional informational full API coverage run reports 89.48% branches. The
  API package is intentionally excluded from the repository CI coverage task; its remaining
  historical-package gap stays a tracked cleanup gate before deleting the legacy compiler.
- Biome passed for every changed TypeScript/TSX/JSON source file, and `git diff --check` passed.
- KnowledgeFS contract generation/check passed after regenerating the contract lock from the exact
  KnowledgeFS change set.

Known repository-wide baseline:

- `pnpm --dir knowledge-fs lint` is not globally green because of pre-existing Admin formatting
  findings, generated capability/OpenAPI formatting findings, and the generated OpenAPI size limit.
  None is in the semantic compiler change set; all changed files pass Biome. These unrelated files
  were deliberately not rewritten in this iteration.

Not performed locally:

- Production migration, deployment smoke, canary imports, historical-document rebuild/backfill,
  sampled shadow comparison, and publication-head rollback drill. Local static/preflight/canary
  simulations and guardrail tests are complete, but these production executions remain SSC.7
  operational gates and must complete before the legacy read/compiler path is removed.
