# Extract Gateway Options

## Summary

- Moved `KnowledgeGatewayOptions` from `packages/api/src/index.ts` into `packages/api/src/gateway-options.ts`.
- Re-exported the contract from the API package entrypoint so external imports remain stable.
- Added a code-health guardrail preventing the large gateway configuration interface from returning to the gateway god file.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `gateway-options.ts` did not exist.
- GREEN: Added the extracted options module and updated the gateway entrypoint to import the contract.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`

## Review Cadence

- This will be implementation commit 3 after review checkpoint `63eca78`.
- Next mandatory 10-commit review is due after 7 more implementation commits.
