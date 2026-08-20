# Quality replay evidence details

## What changed

- Added an optional, item-scoped evidence-detail expansion to the existing quality replay detail
  endpoint. The normal report response remains compact; evidence text is resolved only after the
  user opens one question's hit count.
- Resolved immutable expected evidence nodes in their persisted order and classified each passage
  as hit or missed from the replay's frozen evidence diff.
- Added document name, section path, page number, and passage text to the expanded response without
  exposing internal node identifiers or unrelated retrieved identifiers.
- Made the report's evidence-hit count interactive and added a centered dialog that groups hit and
  missed passages, with loading, retry, empty, inaccessible, and close states.
- Added localized UI copy for every supported dataset locale.

## Why

The report previously exposed only aggregate counts such as `1/2`. That was enough to determine
that an evaluation failed, but not enough to identify which expected passage was absent or inspect
the evidence that did match.

## Security and performance

- Evidence nodes and their backing document assets are rechecked against the current candidate
  grants before text or source metadata is returned. Deleted or inaccessible historical evidence
  is represented by a redacted placeholder.
- Node resolution is one bounded bulk lookup. Backing asset lookups are deduplicated and bounded by
  the expected evidence set, and execute only for the single replay item explicitly requested.
- Replay list and ordinary replay-detail requests do not load evidence text, preventing report
  payload growth across large evaluation runs.

## Verification

- `@knowledge/api` quality-control handler tests: 25 passed.
- `@knowledge/api` typecheck passed.
- Python KnowledgeFS DTO and facade tests: 155 passed.
- Generated Console contract typecheck passed.
- Quality evaluation panel tests: 4 passed.
- Targeted Biome, Ruff, Ruff format, frontend static checks, locale JSON checks, and
  `git diff --check` passed.

## Known risks and follow-up

- Historical evidence may have been deleted or may no longer be visible under the current user's
  grants; the dialog intentionally redacts it instead of reproducing the old content.
- A future report export feature should use a paginated evidence-detail endpoint rather than
  expanding every replay item in one response.
