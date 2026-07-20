# Parser Adapter Contracts

## What Changed

- Added the `@knowledge/parsers` package.
- Added shared parser contracts for `ParserAdapter` and `ParseDocumentInput`.
- Added native Markdown and HTML parsers that emit existing `ParseArtifact` / `ParseElement` core models.
- Added an Unstructured API client skeleton using `fetch` and the legacy `/general/v0/general` partition endpoint.
- Added a parser router that prefers native Markdown/HTML and falls back to Unstructured for complex or unknown document types.

## Why

Sprint 2 needs parser boundaries before the synchronous MVP ingestion path can connect document upload to parse artifact persistence. This slice establishes parser contracts and parser selection without coupling parsing into the upload route yet.

## TDD Notes

- RED: Added `packages/parsers/src/parser.test.ts` before `src/index.ts` existed and confirmed the suite failed on missing parser factories.
- GREEN: Implemented Markdown, HTML, Unstructured, and router behavior until the package tests passed.
- REFACTOR: Added coverage for parser bounds, empty native elements, Unstructured response failures, and response-size guardrails.

## Performance Notes

- Native parser input is bounded by `maxInputBytes`, defaulting to `10 MiB`.
- Parser output is bounded by `maxElements`, defaulting to `20,000`.
- Unstructured response reads are bounded by `maxResponseBytes`, defaulting to `5 MiB`, with both `content-length` precheck and post-read byte validation.
- Parser routing avoids external Unstructured calls for Markdown, plaintext, HTML, and XHTML documents.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/parsers test`
  - `pnpm --filter @knowledge/parsers test:coverage`
  - `pnpm --filter @knowledge/parsers build`
  - `pnpm lint`
- Full verification passed:
  - `pnpm install`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This slice does not persist parse artifacts or update document parser status.
- This slice does not connect parser dispatch to document upload; that belongs to the synchronous MVP ingestion iteration.
- Unstructured integration is fake-fetch tested only; live container smoke remains a future integration test.
