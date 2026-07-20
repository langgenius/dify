# 2026-05-08 Core Domain Models

## Summary

- Added first-sprint core domain model schemas in `packages/core`.
- Covered the contract surface for:
  - `KnowledgeSpace`
  - `Source`
  - `DocumentAsset`
  - `ParseArtifact`
  - `KnowledgeNode`
  - `IndexProjection`
  - `KnowledgePath`
  - `EvidenceBundle`
  - `AnswerTrace`
- Exported the model contracts from `@knowledge/core`.
- Added TDD tests before implementation and confirmed the RED step failed because `./models` did not exist.

## Files Added Or Updated

- `packages/core/src/models.ts`
- `packages/core/src/models.test.ts`
- `packages/core/src/index.ts`
- `.harness/docs/TEMP-progress-document.md`
- `.harness/changes/2026-05-08-core-domain-models.md`

## Why

Sprint 1 requires core data model scaffolding before database migrations and adapter work can be implemented safely.

The Zod domain models establish runtime-validated contracts for the metadata, document, artifact, node, projection, virtual path, evidence, and trace entities described in the `.harness` architecture documents.

## TDD Notes

- RED: Added `packages/core/src/models.test.ts`, then ran `pnpm --filter @knowledge/core test`.
- The test failed because `./models` did not exist.
- GREEN: Added `packages/core/src/models.ts` and exported it from `packages/core/src/index.ts`.
- REFACTOR: Ran Biome formatting and full verification.

## Verification

- `pnpm --filter @knowledge/core test`: passed.
- `pnpm --filter @knowledge/core test:coverage`: passed.
  - `packages/core`: 100% lines, statements, branches, and functions.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.

## Known Risks And Follow-Up

- These are domain-level Zod contracts, not Drizzle database tables yet.
- Next Sprint 1 work should add database schema/migration scaffolding for PostgreSQL/TiDB or a database-neutral schema mapping layer.
- Object storage adapter contract tests and local S3-compatible skeleton remain pending.
