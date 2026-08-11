# Add logical document availability controls

Date: 2026-08-11

## What Changed

- Added single-document and bounded bulk APIs for enabling or disabling logical documents with
  optimistic concurrency through `expectedRowVersion`.
- Added `enabled`, `disabled_at`, and `disabled_by_subject_id` persistence for PostgreSQL and TiDB
  in migration `0041_logical_document_availability`, and exposed the availability state on logical
  document responses.
- Added Dify Console backend delegation for both availability operations. The Dify product
  operation registry maps them to the corresponding KnowledgeFS operations, and Capability v2
  grants authorize the `logical_documents.availability.update` action at document or KnowledgeSpace
  scope as appropriate.
- Kept availability independent from Source state: disabling one logical document does not disable
  its Source or affect sibling documents associated with that Source.

## Runtime Behavior

- Disabled logical documents are excluded from hybrid retrieval candidates.
- Source synchronization skips updates for disabled logical documents while continuing to process
  other documents from the same Source.
- New reindex requests for disabled documents are rejected, and queued compilation work checks
  availability again before execution. A disabled item fails independently without cancelling
  sibling items in the same bulk operation.
- Re-enabling a document permits future synchronization and reindex requests but does not
  automatically start either operation.
- Bulk availability updates report each document independently as updated, `not_found`, or
  `conflict`; one failed item does not roll back successful siblings.

## Safety And Compatibility

- `expectedRowVersion` prevents a stale client from overwriting a newer document update; conflicts
  return HTTP `409` for the single API and an item-level `conflict` result for the bulk API.
- Bulk requests are bounded to 100 documents.
- Tenant, KnowledgeSpace, and document authorization checks run before mutation. Unauthorized
  documents use the existing not-found behavior to avoid exposing their existence.
- Existing rows remain enabled by default, preserving retrieval, synchronization, and indexing
  behavior until a document is explicitly disabled.
- Capability v2 and the product-operation lock fail closed if the Dify and KnowledgeFS operation,
  method, path, action, or resource contracts drift.

## Verification

- Focused KnowledgeFS availability, repository, retrieval, Source workflow, reindex, worker,
  migration, and Capability v2 tests passed.
- KnowledgeFS API and API app typechecks passed.
- Focused Dify product-operation tests passed.
- Ruff checks passed for the changed Dify Python capability and contract files.
- The generated KnowledgeFS product contract lock was updated successfully, and
  `git diff --check` passed.

## Risks And Follow-Up

- Availability is enforced at request admission and worker preflight; work already executing past
  the preflight is not forcefully interrupted.
- Re-enabling a document may leave its index stale until the user explicitly synchronizes or
  reindexes it.
- The backend exposes the required APIs and response fields only; frontend controls are outside this
  change.
