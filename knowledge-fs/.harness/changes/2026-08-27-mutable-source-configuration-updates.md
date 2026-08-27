# Mutable source configuration updates

## What changed

- Added `uri` and `providerParameters` to the Source PATCH contract used by Dify and KnowledgeFS.
- Defined `providerParameters` as a full replacement of `metadata.parameters`, so clearing an optional provider field removes its previously stored value instead of being undone by recursive metadata merging.
- Kept `connectionId` and `permissionScope` out of the general Source PATCH. Connection rebinding and permission-scope migration require dedicated lifecycle operations that can validate provider compatibility and propagate authorization changes to dependent resources.
- Rejected credential-shaped provider parameters and refused replacement when legacy stored parameters still contain credentials.
- Persisted URI changes in both the in-memory and database Source repositories.
- Regenerated the console and Service API TypeScript contracts.
- Extracted the Web Source edit dialog and reused the Add Source website parameter form, including installed-provider declarations, root URL, crawl options, loading/error states, and validation.
- Submitted provider parameters separately from ordinary metadata while retaining the legacy crawl-options projection needed by existing consumers.
- Rejected `metadata.parameters` on PATCH so provider parameters have one unambiguous full-replacement path.
- Changed Dify import reconciliation to send minimal ordinary metadata patches, preserving provider parameters without routing them through the forbidden legacy field.
- Aligned Dify provider-parameter validation with KnowledgeFS for finite numbers and bounded non-empty keys.
- Rejected empty Source patches and `expectedVersion`-only patches so no-op writes cannot create false version conflicts.
- Kept a stable Source/version/sync-policy snapshot for each open edit dialog, preventing a background list refresh from bypassing optimistic concurrency.
- Kept web Source `uri` and provider `url` synchronized when either update path is used.
- Rejected web Source updates that omit the required provider URL, use a non-HTTP(S) URL, or embed credentials in the URL.
- Showed “Using defaults” only when every collapsed crawl option actually equals its provider default.
- Compared provider parameters after applying provider defaults, so restoring the opening values clears the edit dialog's dirty state.
- Removed duplicate pending-state props, patch-condition checks, default calculations, and an immediately overwritten test mock during the final review.
- Added regression coverage for full provider-parameter replacement, cleared optional parameters, unsafe generic PATCH fields, and credential-shaped provider parameters.

## Why

Website Source editing must expose the same provider-defined configuration as Source creation. Treating provider parameters as an ordinary recursive metadata patch made removed fields reappear, while putting connection and permission migration into the generic PATCH would bypass provider and authorization lifecycle guarantees.

## Verification

- Established failing regression tests before implementation for unsupported provider parameters, retained cleared parameters, and unsafe connection/permission mutations.
- `vitest run src/source-handlers-coverage.test.ts src/gateway-source.test.ts src/source-repository.test.ts` (88 passed)
- `tsc --noEmit` in `knowledge-fs/packages/api`
- `pnpm exec biome check` for the eight changed KnowledgeFS API files
- `uv run --project api pytest api/tests/unit_tests/services/test_knowledge_fs_product_dto.py api/tests/unit_tests/services/test_knowledge_fs_data_facade.py api/tests/unit_tests/services/test_knowledge_fs_source_import_commit_service.py api/tests/unit_tests/tasks/test_knowledge_fs_source_import_tasks.py api/tests/unit_tests/tasks/test_knowledge_fs_initial_source_tasks.py -q` (205 passed)
- `uv run --project api ruff check api/services/knowledge_fs/product_dto.py api/tests/unit_tests/services/test_knowledge_fs_data_facade.py api/tests/unit_tests/services/test_knowledge_fs_product_dto.py`
- `pnpm --filter @dify/contracts type-check`
- `pnpm --filter @dify/contracts gen-api-contract`
- `pnpm openapi:export:test` in `knowledge-fs` (2 passed)
- `pnpm build` in `knowledge-fs` (12 packages passed)
- `vp test run --project unit features/new-rag/__tests__/datasource-parameter-form.spec.tsx features/new-rag/__tests__/sources-page.spec.tsx` (67 passed)
- `vp check` for the seven changed Web Source files
- `pnpm --dir web lint:a11y features/new-rag/source-edit-dialog.tsx features/new-rag/source-actions.tsx`
- Verified in the authenticated local browser that Add and Edit use the same Firecrawl declaration and the same collapsed Crawl options presentation; the expanded Edit form exposes URL exclusions/inclusions, crawl depth, page limit, subpages, and main-content controls. Edited the local Source name from `xxx` to `xxx-review-20260827` and the maximum page count from `99` to `37`, then reopened the dialog and confirmed both values persisted and the collapsed options did not claim to use defaults.
- `pnpm lint` in `knowledge-fs` was attempted but remains blocked by pre-existing formatting findings in unrelated Admin/test files and the existing 12.3 MiB OpenAPI artifact exceeding Biome's 1 MiB limit; targeted Biome checks for all seven changed API files passed.
- The monolithic `pnpm check` was not run because it also executes unrelated Docker smoke suites, full evaluation suites, migration checks, and Compose checks; the affected unit, type, OpenAPI, contract-generation, build, and lint boundaries were run directly instead.

## Risks and follow-up

- Updating a URI or provider configuration does not automatically start a sync; callers must explicitly invoke the Source sync workflow when refreshed content is required.
- Existing Sources that contain inline credentials inside provider parameters cannot use generic replacement until those credentials are migrated through the dedicated credential lifecycle.
- Connection rebinding and permission-scope migration remain intentionally unsupported by the generic Source PATCH and should be added only as dedicated operations with provider validation and dependent-resource propagation.
