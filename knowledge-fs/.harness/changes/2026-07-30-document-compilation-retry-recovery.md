# Document compilation retry recovery

Date: 2026-07-30

## What changed

- Parse-artifact upserts now keep parser-generated element ids bound to the first persisted
  artifact id for a document version. Database-backed retries also repair rows written by the old
  behavior, while custom/non-generated element ids remain unchanged.
- Generation-scoped document compilation now resumes from durable checkpoints:
  - `parsed` and later checkpoints reload the canonical parse artifact instead of parsing the
    source object again.
  - `outline_built` and later checkpoints reload and validate the persisted outline and multimodal
    manifest instead of rebuilding the outline, rerunning its LLM summaries, or rematerializing
    PageIndex.
  - Candidate receipt path ids are reconstructed deterministically from the persisted generation.
- An `outline_built` retry removes only failed projections belonging to the unpublished
  generation's deterministic node ids before rebuilding FTS and embeddings. Missing or
  inconsistent checkpoint data fails closed.
- Added regression coverage for canonical element-id replay, checkpoint resume, incomplete or
  inconsistent checkpoint state, embedding-timeout projection recovery, and cleanup preconditions.
- No frontend, API contract, schema, or migration files changed.

## Why

After an embedding/model-runtime timeout, the old retry path parsed the same file again with a new
random parse-artifact id. The logical parse-artifact row retained its original outer id, but its
elements were overwritten with ids derived from the new random id. Rebuilding the already-persisted
generation outline therefore changed an immutable logical value and failed with
`Generation-scoped document-outline ... conflicts with its immutable persisted value`.

The retry also repeated expensive parser, outline-summary LLM, and PageIndex work that had already
completed. Resuming from the durable checkpoint preserves immutable generation identity and limits
the retry to the failed indexing work.

## Database access and performance

- Each compilation execution adds one bounded attempt lookup. A resumed execution performs one
  parse-artifact lookup and canonical upsert, with one conditional repair update only for legacy
  inconsistent generated ids.
- Outline and multimodal-manifest checkpoint reads run in parallel and use the existing
  `(document_asset_id, version, publication_generation)` unique access paths.
- Failed projection cleanup is batched by the configured projection batch size, never queried or
  deleted per node, and is bounded to at most three projection types per node. Existing
  node/projection indexes cover these ids; no new index is required.
- The existing `parse_artifacts_asset_version_uq`,
  `document_outlines_asset_version_uq`,
  `document_multimodal_manifests_asset_version_uq`, and
  `index_projections_node_type_version_idx` indexes remain the required access paths.

## Verification

- TDD red phase reproduced all three failure boundaries:
  - retry-generated element ids did not match the persisted parse-artifact id;
  - a failed FTS projection conflicted during embedding retry;
  - an `outline_built` retry reparsed the document instead of resuming.
- Focused regression suite:
  - `pnpm exec vitest run src/parse-artifact-repository.test.ts src/index-reindexer.test.ts src/document-compilation-worker.test.ts`
  - 3 files, 30 tests passed.
- Full API suite:
  - 373 files passed, 4,104 tests passed, 3 existing environment-dependent tests skipped.
- API coverage:
  - 93.88% lines/statements, 96.34% functions, 90.01% branches.
- `pnpm build` passed for all 12 KnowledgeFS packages.
- `pnpm check` passed, including workspace typechecks/tests, contract determinism, non-API coverage,
  evaluations, migration checks, workflow checks, Compose validation, and static Docker smoke
  checks.
- Biome passed for all six changed TypeScript files.
- Repository-wide `pnpm lint` remains blocked by pre-existing formatting findings in unchanged
  Admin/test/generated-contract files and the existing 1.3 MiB OpenAPI artifact exceeding Biome's
  1 MiB processing limit.

## Risks and follow-up

- Cleanup deliberately deletes only `failed` projections in an unpublished generation. If a
  process is killed before building projections are marked failed, retry still fails closed rather
  than deleting ambiguous state; the existing candidate GC/operator recovery path remains required
  for that uncommon crash boundary.
- Automatic repair recognizes only the parser-owned
  `<uuid>:element-<sequential ordinal>` convention. This prevents the recovery path from silently
  rewriting connector- or operator-owned custom element ids.
- Existing affected jobs need only be retried after deploying this code; no data migration or
  document re-upload is required.
