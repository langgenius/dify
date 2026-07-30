# Semantic Extraction Resilience

## Summary

- Bound entity and relation extraction to four concurrent model requests.
- Retry malformed model JSON and retryable model-runtime failures with a bounded retry budget.
- Convert LLM stream-read aborts into retryable Dify model-runtime timeout errors.
- Validate all returned entities and relations, then retain the highest-confidence results within the configured per-node limit.

## Why

- A 52-node document previously launched enough concurrent model requests to exhaust Dify's database connection pool.
- A stream crossing the request deadline during `reader.read()` leaked the raw abort `Symbol` instead of a retryable runtime error.
- Model responses can occasionally contain malformed JSON or exceed the requested result count; neither condition should fail an otherwise valid document immediately.

## Verification

- Focused semantic extraction and Dify model-runtime client tests pass.
- KnowledgeFS API and Dify model-runtime client typechecks pass.
- Targeted Biome checks pass for the changed files.
- The full KnowledgeFS check and build passed before separating the pre-existing failed-generation compatibility changes into a stash.

## Notes

- Compatibility logic for resuming pre-existing failed generation data is intentionally excluded from this change and stored in a separate git stash.
