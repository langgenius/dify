# Golden-question CSV import fallback for empty spaces

## What changed

- Bulk golden-question import now treats unavailable evidence matching as an unmatched batch and
  creates every valid row as a draft.
- Single-question evidence matching keeps its existing `503` behavior so callers can explain that
  matching is temporarily unavailable.
- Added a gateway regression test covering a valid two-row Unicode CSV payload when the space has
  no active embedding profile.

## Why

The Quality UI promises that unmatched CSV rows are saved as drafts. Empty knowledge spaces do not
have an active embedding profile, so evidence matching can be unavailable rather than returning an
empty candidate list. Rejecting the entire batch in that state contradicted the import contract and
left zero rows persisted.

## Verification

- `pnpm exec vitest run src/gateway-golden-question.test.ts` from `packages/api`: 5 tests passed.
- The Dify web CSV parser and Quality component regressions also passed in their owning workspace.

## Risks and follow-up

- Import intentionally distinguishes capability unavailability from unexpected matcher failures;
  unexpected errors still fail the batch without partial writes.
- Rows imported during matcher unavailability remain drafts until a later explicit evidence-match
  workflow activates them.
