# Research semantic Value Search and LLM tree scoring

Date: 2026-07-30

## What changed

- Replaced the Research query-time exact-term/PageIndex lexical ranker with published dense
  semantic Value Search. Research now embeds the query against the frozen knowledge-space
  embedding profile and reads only the immutable publication's dense projections.
- Added section-level value aggregation and round-robin candidate selection so a long section
  cannot consume the complete candidate window. Candidates are rebuilt into a hierarchy grouped
  first by document and then by `sectionPath`.
- Added a profile-scoped LLM tree scorer. The frozen reasoning model receives the bounded candidate
  tree and complete query, then returns one strict `[0,1]` relevance score and concise reason for
  every candidate. The LLM score is the public final Research score; dense values are recall priors
  only.
- Added strict model-output validation: unknown, duplicated, missing, non-finite/out-of-range, or
  empty-reason entries fail closed, as do model-identity mismatches and timeouts.
- Kept Research isolated from FTS, Graph expansion, fusion, and the ordinary reranker. Fast and
  Deep continue through their existing stacks unchanged.
- Made an activated embedding profile mandatory for new Research configuration, publication,
  runtime snapshots, online queries, async Research tasks, and Retrieval Tests. Historical
  Research-only manifests remain readable but are reported as setup-required and cannot execute.
- Updated API/operator/mode documentation and retrieval diagnostics to describe the new score
  semantics and embedding stage.

## Why

The previous Research score was derived from exact lexical term coverage. A dense or test
retrieval result could therefore show a strong semantic score while Research returned zero because
the query and evidence did not share the same literal characters or terms. PageIndex retrieval is
reasoning over a semantic document hierarchy, not single-character matching. The new pipeline uses
semantic retrieval to find a bounded candidate set and delegates relevance judgment over the
document/section tree to the space's reasoning model.

## Verification

- TDD red/green coverage was added for:
  - semantic rank overriding dense similarity rank;
  - published snapshot, vector-space, metadata, and permission filtering before the LLM;
  - document isolation when different documents contain identically named sections;
  - strict complete structured output, bounded batching, timeout/model identity, and score range;
  - inclusive Research thresholding and Fast/Deep delegation;
  - Research embedding generation and fail-closed configuration/runtime prerequisites.
- `pnpm --filter @knowledge/api test`: 373 passed test files, 4,099 passed tests; one database-only
  file and three tests remained skipped.
- `pnpm --filter @knowledge/api-app test`: 42 files and 209 tests passed.
- `pnpm --filter @knowledge/core test`: 4 files and 56 tests passed.
- Workspace `pnpm test`: all 22 Turbo tasks passed.
- Workspace `pnpm build`: all 12 build tasks passed.
- `@knowledge/api` and `@knowledge/api-app` typechecks passed.
- Focused Biome check passed for all 37 changed TypeScript/HTML files; `git diff --check` passed.
- Root `pnpm lint` remains blocked by ten pre-existing findings in unchanged Admin/test/generated
  contract files, including the existing 1.3 MiB OpenAPI artifact exceeding Biome's 1 MiB limit.
- Repository-wide `pnpm check` was not run because it expands beyond this change into Docker image
  builds, compose validation, evaluation suites, and a local-stack happy-path. The affected package
  suites, complete workspace test/build, typechecks, and focused lint were run instead.

## Performance and operational bounds

- Research retrieves at most 100 published dense candidates in one repository call; it does not
  perform an N+1 database walk of PageIndex nodes.
- LLM scoring uses batches of 10 candidates, at most four concurrent batches, at most 1,500
  characters of evidence per candidate, the configured 1,024-token default output budget, a
  64,000-character response cap, and a 20-second timeout per batch.
- Metadata and ACL defense filters run before any candidate text is sent to the reasoning model.

## Risks and follow-up

- Research now intentionally adds reasoning-model latency and token cost. The bounded concurrency
  limits tail latency and provider load, but operators should compare Research latency/cost against
  Fast for their selected model.
- Scores are calibrated by a fixed rubric in the prompt, but different reasoning models can still
  have different calibration. Golden-question replay should be used before changing the score
  threshold or reasoning model.
- Batching means one LLM call does not see candidates assigned to another batch. Section-level
  semantic priors and deterministic value/diversity selection reduce that tradeoff, while keeping
  prompts and output contracts bounded.
- Provider, timeout, or malformed-output failures fail the Research request; they do not silently
  fall back to lexical ranking or expose unverified scores.
