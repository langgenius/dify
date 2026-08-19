# Quality replay visibility across capability grant rotation

Date: 2026-08-19

## What changed

- Quality replay history now resolves capability-backed runs through the subject and content scope
  recorded by their original capability grant instead of requiring the current request to reuse
  the same short-lived grant identifier.
- Legacy permission-snapshot runs retain their existing subject and candidate-scope visibility.
- Replay cancel and retry authorization uses the same historical visibility rule after first
  validating the current write admission, so a refreshed Console session can operate on a run it
  created earlier.

## Why

Console requests receive a newly issued Capability v2 grant. Replay rows correctly keep the grant
used at creation as durable provenance, but list, get, cancel, and retry treated that provenance ID
as the current visibility credential. The next request therefore filtered out an otherwise valid
run, leaving the evaluation task list empty even though the worker had completed the evaluation.

## Regression contract

- A new current grant for the same subject and an equal or broader content scope can read a replay
  created under an earlier grant.
- The current grant ID is never used as the historical replay locator.
- Tenant, knowledge-space, original subject, and content-scope boundaries remain in the SQL before
  pagination or mutation locking.
- Retry persists the newly admitted grant as the next execution's provenance.

## Verification

- Focused quality-control tests: 94 passed.
- Complete `@knowledge/api` suite: 416 files passed, 1 skipped; 4,609 tests passed, 3 skipped.
- `@knowledge/api` typecheck and focused Biome checks passed.
- The corrected PostgreSQL predicate returned both existing passed replay runs for the affected
  test knowledge space while the deployed exact-grant predicate returned none.
