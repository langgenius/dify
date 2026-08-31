# Unstructured large-document timeout

## What changed

- Raised the maximum configurable Unstructured request timeout from 30 to 60 minutes. The default
  remains two minutes.
- Marked a client-side Unstructured deadline as non-retryable.

## Why

The 295-page 009 annual report completed in Unstructured after about 38 minutes, so the previous
30-minute ceiling rejected a workload that the parser could process successfully.

Aborting the synchronous HTTP request does not prove the server-side parser stopped. Automatically
retrying at that point can overlap an orphaned parse and multiply CPU and memory usage. Transport
failures and retryable HTTP responses keep their existing retry behavior.

## Verification

- Parser tests: 83 passed.
- API parser-option tests: 7 passed.
- Full `pnpm check` passed.
- Full KnowledgeFS build: 12 packages passed.
- Targeted Biome and `git diff --check` passed.
- Full `pnpm lint` remains blocked by 10 pre-existing errors in unrelated files, including admin
  formatting/import findings and the generated 12.3 MiB OpenAPI document exceeding Biome's 1 MiB
  input limit. Those files were intentionally left untouched.

## Known risk

A longer configured deadline keeps one bounded parser-concurrency slot occupied for longer. The
default remains unchanged, and operators must opt in to a higher value for unusually large OCR
documents. No follow-up code change is currently required.
