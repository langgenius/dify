# KnowledgeFS metadata catalog

## What changed

- Added a durable, per-knowledge-space metadata field catalog with `string`, `number`, and `time` field types.
- Added document-to-field bindings so field usage counts no longer require scanning every document.
- Added metadata field list, create, rename, and delete APIs in KnowledgeFS and the Dify console proxy.
- Made document metadata writes validate field definitions and update the document, bindings, and active retrieval asset in one database transaction.
- Made field rename and delete cascade to bound document values and active retrieval metadata.
- Updated the KnowledgeFS document UI to read and mutate the field catalog directly instead of deriving it from paginated document data.
- Included nested `userMetadata` in retrieval metadata filtering.

## Data migration

Migration `0040_knowledge_space_metadata` creates the catalog and binding tables and backfills consistently typed custom metadata already stored on logical documents. Reserved system keys and inconsistently typed values are left unbound rather than inventing an unsafe catalog type.

## Compatibility

- Existing document metadata remains readable.
- A custom field must exist in the space catalog before a new value can be assigned.
- Catalog mutations use row-version compare-and-swap semantics.
- No default value is written to every document when a field is created.

## Verification

- Database schema and migration suites.
- Metadata repository, handler, logical-document lifecycle, and retrieval candidate suites.
- Dify facade, product operation, and controller delegation suites.
- KnowledgeFS TypeScript type checking and Biome checks.
- Frontend metadata page tests, Vite+ checks, and TypeScript type checking.
