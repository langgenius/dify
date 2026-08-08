# Initial Firecrawl source import during knowledge-space creation

Date: 2026-08-08

## What changed

- Added an optional initial website Source contract to knowledge-space creation so Dify can submit
  the Firecrawl provider settings, crawl options, and the exact URL selection made during preview.
- Added the Capability v2 operation and product route used to create and monitor the initial
  `crawl-import` Source workflow after the Space becomes available.
- Kept preview and import as separate crawls. The import freezes the submitted URL selection and
  materializes only pages returned by the second crawl that match the selected source URLs; missing
  selected pages fail the import instead of silently importing different content.
- Added provisional Source handling so the knowledge-space metadata remains valid when initial
  content import fails. Terminal workflow state and the specific available error details are
  retained on the disabled Source instead of removing it from subsequent Source listings.
- Made the Dify Celery bridge retry while Space provisioning or the initial Source workflow is still
  active, and made repeated workflow-start requests idempotent so polling retries do not create a
  second import or turn an accepted request into a gateway failure.
- Added Source workflow diagnostics around crawl output, content materialization, logical revision
  publication, and terminal failures. Source-document compilation failures now preserve their
  specific cause for task and operator diagnostics.
- Recovered caller-visible Source sync workflow state through bounded Source-list responses so the
  UI can show active and terminal status after reload without per-Source polling.
- Fixed multimodal descriptor path collisions during document compilation. Items that would share
  the legacy title plus short-id filename now use a deterministic SHA-256 suffix derived from the
  complete item id. Descriptor filenames are bounded by the 384-character virtual-path limit, while
  non-conflicting legacy paths remain unchanged for published-document compatibility.

## Why

The new knowledge-base flow allowed users to preview Firecrawl pages before a KnowledgeFS Space
existed, but creation did not reliably carry the selected pages into a durable Source import. The
initial implementation also exposed several failure-path gaps: retries could repeat a workflow
start, failed provisional Sources could disappear or lose their useful error, and a successful crawl
could still fail document compilation when two same-title multimodal items generated the same
generation-scoped KnowledgePath with different immutable metadata.

This slice makes the preview selection authoritative while preserving the requested product
behavior: the knowledge space is retained even if website import fails, and existing task and Source
status surfaces report the failure. It also removes the observed multimodal publication conflict
without changing paths for previously published, non-conflicting items.

## Verification

- Targeted KnowledgeFS Source workflow, repository, handler, logical-document adapter, and contract
  tests passed during development, including selection mismatch, idempotent retry, failed
  provisional Source, and error-propagation regressions.
- `pnpm --dir knowledge-fs exec vitest run packages/api/src/document-knowledge-paths.test.ts packages/api/src/document-multimodal-candidate-resolver.test.ts`
  passed: 3 tests.
- `pnpm --dir knowledge-fs typecheck` passed all 22 Turbo tasks after the multimodal path fix.
- Targeted Biome checks passed for the changed KnowledgeFS TypeScript files, and `git diff --check`
  passed.
- Dify backend formatting and KnowledgeFS OpenAPI/Capability export drift failures encountered in CI
  were corrected as part of the integration work.
- Runtime validation against the deployed Dify-connected environment completed one selected-page
  import with Source workflow `8ab696e2-5e44-4814-910a-3952fde8ba1a`: `run_state=completed`,
  `checkpoint=source-committed`, `progress_completed=1`, and no terminal error. Its document
  compilation durable task completed, and the Dify Celery task finished successfully.
- The preceding clean reproduction failed at `checkpoint=parsed` with
  `GENERATION_SCOPED_COMPONENT_CONFLICT`; the same selected page completed after the descriptor-path
  fix, with no recurrence of that error.

## Risks and follow-up

- Preview and import intentionally perform separate provider crawls. A selected URL that is absent
  from the second crawl is reported as an import failure; the knowledge space and failed disabled
  Source remain available for inspection or retry.
- The Celery task polls active KnowledgeFS workflow state every two seconds. This is bounded by the
  task retry policy but can produce repetitive informational logs during a long crawl.
- The deterministic hash fallback uses the full item id as input and a fixed 16-hex-character suffix.
  Existing non-conflicting descriptor paths retain the legacy filename; items that previously
  collided could not be published successfully and therefore require no compatibility mapping.
- The complete release-candidate command set from `docs/operator-manual.md` was not rerun as one
  final local sequence. Targeted tests, type checking, lint/format checks, CI iterations, and the
  deployed Dify-connected workflow were used for this slice; the full promotion checklist remains a
  release-time requirement.
- The temporary task and progress documents were intentionally removed after the original project
  cycle completed. Per `.harness/agents/development-requirements.md`, this permanent change record is
  used instead of recreating `TEMP-progress-document.md`.
