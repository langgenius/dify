# Durable deletion accepts reserved upload-session objects

## What changed

- Centralized construction of the upload-session object key and its tenant/space-scoped prefix.
- Extended durable document-deletion inventory and external-object validation to accept both:
  - the manifest-owned immutable space prefix used by derived artifacts; and
  - the exact `namespaces/{tenant}/spaces/{space}/uploads/` prefix used by raw upload sessions.
- Kept storage listing validation bound to the exact prefix requested from the object store.
- Added PostgreSQL and TiDB regression coverage proving that a logical-document deletion can
  inventory and remove its raw upload object while still rejecting another space's upload prefix.

## Why

Raw files created through upload sessions use the reserved `namespaces/.../uploads/...` key family,
while KnowledgeSpace manifests use `{tenant}/spaces/{space}` for derived objects. Durable deletion
validated every database-backed object against only the manifest prefix, so deleting any uploaded
logical document failed in the quiescing inventory phase. The active failed deletion then fenced all
new writes in that KnowledgeSpace, causing a later upload completion to surface as not found.

## Verification

- Reproduction test failed before the implementation with
  `Durable deletion object key escapes the immutable space prefix` for both PostgreSQL and TiDB.
- Focused regression passed for both dialects after the implementation.
- Upload-session, completion-publisher, and durable-deletion test files passed: 132 tests.
- Full `@knowledge/api` suite passed: 4,549 tests across 412 test files, with the existing
  3 tests / 1 file skipped.
- `@knowledge/api` TypeScript typecheck passed.
- Biome checks and `git diff --check` passed for the changed source and test files.

## Risks and follow-up

- No database migration or index change is required; deletion continues to use bounded pages and
  existing indexed document/job lookups.
- A deletion job that already exhausted its automatic attempts before rollout remains fenced and
  requires the existing authorized retry operation after the fixed runtime is deployed.
