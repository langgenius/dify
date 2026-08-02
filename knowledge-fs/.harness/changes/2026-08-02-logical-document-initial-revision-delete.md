# Logical document initial-revision deletion

Date: 2026-08-02

## What changed

- Split logical-document deletion from document-asset deletion at both the Dify Console BFF and
  KnowledgeFS request-contract boundaries.
- Logical-document deletion now accepts a non-negative row version, including the initial
  `expectedRevision: 0` value returned by the logical-document API.
- Document-asset deletion remains strictly positive; the shared asset payload was not relaxed.
- Updated the durable deletion repository guard so compare-and-swap deletion can target an
  initial logical-document row version of zero.
- Regenerated the Dify Console TypeScript contract and added controller, facade, handler,
  repository, and generated-contract regression coverage.

## Why

Logical documents are created with `row_version = 0`, and their response contract already exposes
zero as a valid row version. The delete route incorrectly reused the document-asset payload, whose
version starts at one. As a result, a correct delete request for a newly created logical document
was rejected first by Dify's Pydantic validation and, if it reached KnowledgeFS, by the shared Zod
and repository positive-integer guards.

This change gives the two independently versioned resources separate payload contracts and keeps
optimistic concurrency intact. It does not bypass or remove the expected-revision check.

## Performance and reliability

- The deletion path, transaction count, SQL compare-and-swap predicate, and durable job behavior
  are unchanged.
- Validation remains constant time and no additional remote calls or database queries were added.
- A stale zero revision still conflicts after the logical document advances to a later row version.
- The idempotency-key requirement remains unchanged.

## Verification

- TDD red phase reproduced rejection at all affected boundaries:
  - KnowledgeFS route validation rejected logical `expectedRevision: 0`.
  - PostgreSQL and TiDB repository tests rejected a zero logical row version.
  - Dify Console payload validation rejected a zero logical row version.
  - The generated Console client contract rejected a zero logical row version.
- Focused KnowledgeFS handler and repository tests passed: 2 files, 85 tests.
- KnowledgeFS API typecheck passed.
- `pnpm check` and `pnpm build` passed.
- Dify controller and data-facade tests passed: 104 tests.
- Targeted Dify Ruff, Pyrefly, and Mypy checks passed.
- Generated Console logical-document deletion contract smoke test passed.
- Generated Console contract typecheck passed.
- Contract generation and lock checks passed.
- Targeted Python Ruff and KnowledgeFS Biome checks passed.
- `git diff --check` passed.

## Known risks / follow-up

- The Dify API and KnowledgeFS API must both be deployed before retrying the production request;
  deploying only one side leaves another rejecting boundary in place.
- Full `pnpm lint` remains blocked by 10 pre-existing findings in unchanged Admin, fixture,
  OpenAPI, and generated capability files. All changed KnowledgeFS TypeScript files pass focused
  Biome checks.
- The standalone KnowledgeFS API coverage command executes all tests successfully but the existing
  repository-wide branch result is 89.94%, below its 90% threshold. This change adds no runtime
  branches, and the changed request-schema file reports 100% coverage.
- The production request supplied for diagnosis was not replayed because it was destructive.
- Temporary progress documents were not recreated; this change record is the traceability source
  for this fix.
