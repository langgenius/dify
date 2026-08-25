# Capability-authorized unpublished profile settings

## What changed

- Unpublished embedding and retrieval profile updates now pass the admitted Capability v2 grant
  to the atomic activation repository instead of requesting a second legacy admin permission
  snapshot.
- Legacy and API-key callers retain the existing durable permission-snapshot authorization path.
- Added handler regression coverage for Capability-authorized embedding and retrieval updates when
  the space has active profiles but no published profile binding.

## Why

Dify had already authorized `knowledge_spaces.settings.update`, but spaces with active profile
heads and no publication binding entered the unpublished activation path. That path unconditionally
required the replicated KnowledgeFS admin aggregate and returned 403 even though the Capability v2
grant was valid and durably admitted.

## Verification

- Reproduced the bug first: the new handler test returned 403 before the implementation change.
- `pnpm exec vitest run src/knowledge-space-profile-handler-behavior.test.ts` from `packages/api`:
  44 tests passed.
- `pnpm --filter @knowledge/api test`: 4,628 tests passed and 3 skipped.
- `pnpm --filter @knowledge/api typecheck`: passed.
- `pnpm exec biome check packages/api/src/knowledge-space-handlers.ts packages/api/src/knowledge-space-profile-handler-behavior.test.ts`:
  passed.
- `pnpm build`: passed for all workspace packages.
- `pnpm lint`: passed.

## Risks and follow-up

- No schema or migration changes are required because the activation repository already supports
  mutually exclusive Capability grant and permission-snapshot provenance.
- Deployment-level verification still requires rebuilding and recreating the KnowledgeFS API
  container, then repeating the settings update against a space without a publication binding.
