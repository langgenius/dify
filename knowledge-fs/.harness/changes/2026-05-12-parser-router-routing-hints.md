# Parser Router Routing Hints

## Summary

- Completed the Sprint 11 parser router routing policy slice.
- Router selection now considers file type, native parser size limits, OCR requirements, layout complexity, and language hints.

## Changes

- Added optional `parserHints` to `ParseDocumentInput`.
- Added `ParserRouteHints` with `requiresOcr`, `layoutComplexity`, and `language`.
- Added `maxNativeInputBytes` and `nativeLanguages` to `createParserRouter()`.
- Native Markdown/HTML routing remains the fast path for simple supported files.
- Oversized native candidates, OCR-required files, complex-layout files, unsupported native languages, and unknown binaries route to Unstructured.
- Router metadata now includes `routeReason` alongside `routedParser`.

## Performance Notes

- Large files are routed away from native parsers before decoding/tokenization.
- OCR and complex layout hints avoid wasting Workers/Node CPU on native parser attempts that cannot satisfy the document requirements.
- Language gating is configured through an allowlist to keep native parsing predictable.

## Verification

- RED first:
  - `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`
- GREEN/full verification:
  - `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`
  - `pnpm --filter @knowledge/parsers typecheck`
  - `pnpm --filter @knowledge/parsers test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Cadence

- This is implementation commit 9 after reviewed checkpoint `3b9b4d8`.
- The next implementation commit will trigger the mandatory 10-commit health review.
