# Golden-question published-generation evidence resolution

Date: 2026-08-02

## What changed

- Golden-question create and update validation now resolves evidence node ids across retained
  publication generations.
- Production bad-case promotion and failed-query promotion use the same durable evidence lookup.
- Direct document-asset evidence ids, candidate permission checks, backing-asset checks, and
  required-permission snapshots remain unchanged.
- Added a regression proving that a node from a published generation can be selected from evidence
  search and saved as an expected evidence id.

## Why

Evidence matching reads the immutable published projection snapshot, so the returned node ids
belong to a publication generation. Golden-question validation previously called the ordinary
generation-scoped `getMany` repository method without a generation id. That method intentionally
defaults to legacy rows whose `publication_generation_id` is null. A valid published candidate was
therefore misclassified as a direct document-asset id and the save failed with `404 Expected
evidence not found`.

The repository already owns `getManyByIdsAcrossGenerations` specifically for durable evidence
references whose globally unique ids survive publication changes. Using that lookup makes the
search and save boundaries agree without weakening authorization.

## Performance and reliability

- Node lookup remains one bounded batch for all selected evidence ids; there is no per-node query.
- The existing maximum of 50 expected evidence ids still bounds the cross-generation lookup.
- Backing document assets are still checked before persistence and malformed or unauthorized
  permission scopes continue to fail closed.
- Published and retained generations are addressed only by globally unique node ids; no
  unbounded generation scan is introduced.

## Verification

- TDD red phase reproduced the failure: a published-generation node was ignored by the legacy
  `getMany` path and the expected permission scope was empty.
- Focused golden-question and failed-query handler and gateway tests passed: 4 files, 38 tests.
- KnowledgeFS API typecheck passed.
- `pnpm check` passed, including workspace tests, coverage gates, evaluations, contract checks,
  migration checks, Compose validation, and smoke-test definitions.
- `pnpm build` passed for all 12 packages.
- The four changed TypeScript source/test files pass focused Biome checks, and `git diff --check`
  passed.
- The Dify KnowledgeFS contract lock was intentionally refreshed and its `--check` command passed.
  This fix does not add a Golden Question OpenAPI or Capability v2 contract change; the staged
  OpenAPI digest update belongs to the separate logical-document deletion fix.

## Known baseline

- Full `pnpm lint` remains blocked by 10 pre-existing findings in unchanged Admin, fixture,
  OpenAPI, and generated capability files. No finding is in a file changed by this fix.

## Rollout

- The KnowledgeFS API must be rebuilt and redeployed before retrying the Console PATCH request.
- The production request supplied for diagnosis was not replayed because it mutates user data.
