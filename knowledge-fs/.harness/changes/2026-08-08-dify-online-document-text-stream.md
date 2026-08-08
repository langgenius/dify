# Dify online-document text stream compatibility

Date: 2026-08-08

## What changed

- Updated the API online-document connector to consume Dify datasource `text` messages from
  `message.text` and concatenate streamed chunks in order.
- Added support for the current Dify datasource `variable` protocol: `content` values with
  `stream: true` are appended, non-streamed `content` values replace prior content, and unrelated
  variables are ignored.
- Retained the existing last-non-empty replacement behavior for structured
  `{ result: { content } }` envelopes.
- Added regression coverage using the real Dify datasource message shape plus compatibility
  coverage for the structured envelope.
- Added one safe content-fetch diagnostic containing only bounded frame types, message field names,
  recognized-frame count, and final UTF-8 byte length. Empty documents remain valid connector
  results; neither content nor credentials are logged.

## Why

Notion page content arrived through Dify as streamed `variable` messages containing
`message.variable_name`, `message.variable_value`, and `message.stream`, while the connector only
read `text` and structured `result.content` envelopes. The ignored messages produced a zero-byte
Markdown asset, zero knowledge nodes, and a terminal compilation failure because no FTS projection
existed.

## Verification

- RED: `pnpm --filter @knowledge/api-app test -- online-document-options.test.ts` reproduced an
  empty content result for two Dify text messages.
- GREEN: the same command passed all 211 tests across 42 API-app test files after the fix.
- RED: the empty-document diagnostic regression test confirmed that empty content already returned
  successfully but no structural frame diagnostic was emitted.
- RED: production-shaped `variable` messages reproduced the zero-byte result; the connector now
  aggregates only the `content` variable and reports recognized frames and non-zero byte length.
- `pnpm check` passed, including typecheck, 4,269 API tests plus the remaining workspace tests,
  coverage gates, evaluation gates, migration checks, Compose checks, and smoke tests.
- `pnpm build` passed all 12 workspace package builds.
- Focused Biome checks passed for both modified TypeScript files. The full `pnpm lint` command is
  blocked by nine pre-existing formatting/lint errors outside this change (Admin files, a test
  helper, and the generated capability operations JSON); those unrelated files were not modified.

## Risks and follow-up

- Text chunks are accumulated in memory, matching the existing bounded datasource response path.
- No protocol or behavior changes were made to page listing, online-drive downloads, or structured
  page-content envelopes.
