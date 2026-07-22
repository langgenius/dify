# Native Structured Data Parsers

## Summary

- Added native structured data parsing for CSV, JSON, JSONL/NDJSON, YAML, and XML.
- Wired structured data formats into the parser router.

## Changes

- Added `createNativeStructuredDataParser()`.
- Added `native-structured` to the shared `ParseArtifact` parser enum.
- Added parser dependencies:
  - `csv-parse`
  - `yaml`
  - `fast-xml-parser`
- CSV and JSONL object rows parse into table elements with columns and row counts.
- JSON, YAML, XML, and non-tabular structured values parse into code elements with pretty JSON text.
- Router now sends structured data formats to the configured native structured parser and records `routeReason: "structured-file-type"`.

## Performance Notes

- Structured parser uses the existing `maxInputBytes` and `maxElements` bounds.
- Added `maxRows` for CSV/JSONL/tabular arrays to prevent unbounded row materialization.
- Router only uses the structured parser when configured, preserving existing fallback behavior for runtimes that have not enabled it.

## Verification

- RED first:
  - `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`
- GREEN/full verification:
  - `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`
  - `pnpm --filter @knowledge/parsers typecheck`
  - `pnpm --filter @knowledge/parsers test:coverage`
  - `pnpm --filter @knowledge/core test -- src/models.test.ts`
  - `pnpm --filter @knowledge/core test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Cadence

- This is implementation commit 10 after reviewed checkpoint `3b9b4d8`.
- Mandatory 10-commit health review must start immediately after this commit is pushed.
