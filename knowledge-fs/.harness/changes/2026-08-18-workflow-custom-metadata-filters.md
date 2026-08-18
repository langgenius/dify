# Workflow KnowledgeFS custom metadata filters

Date: 2026-08-18

## What changed

- Replaced the KnowledgeFS workflow node's fixed diagnostic filter form with the same manual
  metadata-filter interaction used by the existing Knowledge Retrieval node.
- The editor loads the user-created metadata catalogs for every selected knowledge space and only
  offers fields that exist with the same name and type in all of them. Stable synthetic field ids
  keep conditions valid even though each space owns a different catalog-row id.
- Added bounded string, number, and time conditions, `and`/`or` composition, workflow-variable
  resolution, and disabled/manual modes. Automatic LLM-generated metadata filtering is not exposed
  for this node.
- Extended the Dify-to-KnowledgeFS retrieval-test contract with typed `customMetadata` filters.
  Existing fixed filters remain accepted at runtime so already-saved workflow graphs continue to
  execute unchanged, but they are no longer offered by the editor.
- Applied custom metadata predicates to PostgreSQL and TiDB dense/full-text retrieval SQL before
  `LIMIT`, then retained the in-memory evaluator as a defense-in-depth check for non-database test
  repositories and composed retrieval paths.

## Why

The node displayed internal retrieval diagnostics such as freshness, entity, node kind, source id,
and language as if they were document metadata. Those fields did not represent the metadata catalog
that users create and assign to documents, so the workflow editor was inconsistent with the
existing Knowledge Retrieval node and could not express filters such as `department = finance` or
`priority >= 3`.

Fetching each selected space's catalog and intersecting by both name and type gives one condition
that is valid for every configured retrieval request. Pushing the predicate into each database
retrieval leg avoids fetching a top-K set first and then discarding matching documents too late.

## Verification

- Frontend Knowledge Retrieval and KnowledgeFS v2 focused suite passed: 8 files and 45 tests.
- Frontend focused coverage passed; the new field-intersection helper covers all string, number, and
  time mappings.
- Dify workflow/DTO focused suite passed: 71 tests; Ruff passed and mypy with optional missing
  dependency stubs ignored reported no issues in the three changed Python source files.
- KnowledgeFS custom metadata, retrieval candidates, route/handler, executor, and SQL suite passed:
  5 files and 36 tests.
- The complete `@knowledge/api` suite passed before final contract generation: 412 files passed, 1
  skipped; 4,544 tests passed, 3 skipped.
- `@knowledge/api` typecheck, focused Biome checks, and OpenAPI export tests passed.
- The new custom metadata evaluator has 98.76% line/statement, 100% function, and 96.87% branch
  coverage. The repository-wide API coverage command retains its existing branch baseline below the
  configured global threshold; this change's new evaluator exceeds the threshold independently.

## Risks and follow-up

- Selecting multiple spaces deliberately hides a field when its type differs between spaces. This
  prevents a numeric comparison from being sent to a space where the same name is a string.
- A metadata-catalog request failure is not treated as an empty successful catalog, so a transient
  request cannot silently delete saved workflow conditions. The editor remains conservative until
  every selected catalog has loaded successfully.
- Legacy fixed filters remain executable for backward compatibility but are hidden from new edits.
  A future graph migration can remove them after an explicit compatibility window.
- Metadata field reads are one cached, paginated request per selected space (the node already caps
  selection at ten spaces); retrieval itself remains a single request per selected space with no
  per-document metadata lookup.
