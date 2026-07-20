# Durable Local Database Repositories

## Summary

- Completed DLR.2 from the Durable Local Runtime Track.
- Added API app repository wiring that switches core repositories to database-backed implementations when `DATABASE_URL` is configured.
- The bundled repositories cover KnowledgeSpace, DocumentAsset, ParseArtifact, KnowledgeNode, and IndexProjection persistence together.
- Added `KNOWLEDGE_DATABASE_REPOSITORIES=off|false|0` as an escape hatch for bounded memory fallback during local debugging.

## TDD Notes

- Red: API app tests required `createApiDatabaseRepositories()` and source entrypoint injection; the suite failed because `./repository-options` did not exist.
- Green: implemented the repository bundle, added source entrypoint wiring, and documented the runtime behavior.

## Performance Notes

- The bundle uses existing database repositories, which keep parameterized SQL, explicit `maxRows`, stable list limits, and batch limits.
- Core persistence switches as one unit to avoid a mixed in-memory/database state where upload, artifact, nodes, and projections drift apart.
- Missing `DATABASE_URL` still returns an empty options object so no-config tests and development keep bounded memory fallbacks.

## Verification

- Passed:
  - `pnpm --filter @knowledge/api-app test -- src/repository-options.test.ts`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
