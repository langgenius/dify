# Background Task Object Titles

## Problem

The Task drawer displayed a single-document re-index as `Re-index · 1` because progress count
took precedence over the document title. Source sync rows depended on the Source list page already
being loaded; otherwise their one-item progress count was also presented as the object name.

## Changes

- Persist the logical-document title or asset filename in newly created re-index bulk-operation
  items, so a single re-index has a durable display title.
- Add an optional `sourceTitle` to the background-task contract. The task handler resolves all
  selected Source task names in one bounded, space-scoped repository query, rechecks content
  grants, and treats title lookup as non-critical enrichment.
- Return the same Source title from cancel and retry responses. Deleting, unavailable, or
  unauthorized Sources never disclose a name and do not make task listing unavailable.
- Prefer object names in both task drawer implementations. A true multi-document re-index may
  still show its item count, while a single task without a resolvable name no longer labels itself
  as `1`.

## Verification

- Focused KnowledgeFS background-task, Source repository, and re-index persistence tests cover
  PostgreSQL and TiDB placeholders, one-query enrichment, permission filtering, enrichment
  degradation, and durable filename capture.
- Focused document-list and document-detail UI tests cover single re-index filenames and Source
  task-provided names when the Source list is not loaded.
- The Dify DTO test covers camel-case `sourceTitle` validation and the generated TypeScript API
  contract.
