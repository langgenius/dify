# KnowledgeSpace Quota Admission

## Summary

- Added a KnowledgeSpace quota admission helper that enforces manifest quota limits for raw document bytes, artifact bytes, segment count, node count, and projection count.
- Admission checks skip usage reads when all supported manifest quota limits are disabled.
- Admission checks fail closed when bounded usage reads are truncated, avoiding undercounted quota decisions.
- Wired manifest quota admission into single and bulk document upload before object storage writes and staged commit publication.
- Added a bulk reindex job-admission quota guard and documented the 413 response in the OpenAPI route contract.
- Exported the admission helper from the API package for later job and workflow integrations.

## TDD Notes

- Added unit coverage proving:
  - disabled supported limits do not read usage.
  - projected usage above manifest quota limits is rejected.
  - truncated bounded usage fails closed.
- Extended document write gateway coverage proving:
  - manifest raw-byte quota violations return `413`.
  - rejected uploads do not write staged document objects.
  - upload traces include the manifest quota check span.

## Verification

- `pnpm exec biome check --write packages/api/src/knowledge-space-quota-admission.ts packages/api/src/knowledge-space-quota-admission.test.ts packages/api/src/knowledge-space-quota-usage.ts packages/api/src/document-write-handlers.ts packages/api/src/document-write-routes.ts packages/api/src/gateway-document-write.test.ts packages/api/src/index.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-space-quota-admission.test.ts src/knowledge-space-quota-usage.test.ts src/gateway-document-write.test.ts`
- `pnpm --filter @knowledge/api typecheck`
