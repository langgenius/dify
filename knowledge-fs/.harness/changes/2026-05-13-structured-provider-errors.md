# Structured Provider Errors

## Summary

- Completed the R2 provider reliability boundary from `docs/code-review-issues.md` by adding explicit provider error classes to generation, embeddings/rerankers, and parser clients.
- Preserved existing bounded input/response behavior while making validation, rate-limit, request, and malformed-response failures distinguishable by callers.

## Changes

- Added exported `ProviderError`, `ProviderInputError`, `ProviderRateLimitError`, `ProviderRequestError`, and `ProviderResponseError` boundaries to provider packages.
- Classified HTTP 429 failures as rate-limit errors and other failed provider statuses as request errors.
- Classified invalid JSON, invalid provider payloads, bad vector dimensions, and oversized provider responses as response errors.
- Classified bounded input and provider runtime option violations as input errors.
- Added regression assertions across generation, embedding/reranker, and Unstructured parser tests.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
- `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`

## Notes

- This closes the structured-error portion of R2. The remaining code-review remediation queue continues with R3: migration runner and lifecycle closure.
