# Allow integrated Overview reads through Capability v2

Date: 2026-07-29

## What changed

- Updated the Knowledge-space Overview authorization boundary to resolve read grants directly from
  an exact Capability v2 grant before consulting the legacy member/policy aggregate.
- Kept the existing tenant-scoped space lookup and the exact namespace, subject, parent-space, and
  content-scope validation performed by `currentCandidateGrants`.
- Added a regression test covering the four Dify Overview read operations with no legacy ACL
  decision: stats, query outcomes, inventory, and product health.

## Why

Integrated Dify provisioning deliberately does not replicate the legacy
`knowledge_space_members`, `knowledge_space_access_policies`, or API-access rows. The gateway
authorization middleware already recognizes that boundary, but the Overview handlers performed a
second unconditional legacy authorization check. As a result, correctly signed, route-bound
Capability v2 requests returned 403 for newly integrated spaces.

## Verification

- Confirmed RED first: the new regression test returned 403 before the handler change.
- Targeted Overview handler suite passed: 15 tests.
- Full `@knowledge/api` suite passed: 371 files and 4,078 tests; the existing database-only suites
  remained skipped (1 file / 3 tests).
- `@knowledge/api` typecheck and build passed.
- Biome passed for both changed TypeScript files.
- Root `pnpm lint` was run and remains blocked by nine pre-existing formatting/lint errors in
  unrelated Admin, test setup, and generated contract files; neither changed file is reported.
- The repository-wide `pnpm check` was not run because it expands into Docker builds, compose
  validation, coverage, evaluation, and local-stack smoke suites. The affected package's full test,
  typecheck, build, and focused lint gates were run instead.

## Risks and follow-up

- This change is intentionally read-only. Capability v2 does not currently publish an Overview
  attention-transition operation, so write authorization continues to use the legacy durable
  permission snapshot path.
- The fix adds no database round trip: it replaces the failed legacy ACL lookup with validation of
  the already-authenticated in-request grant.
