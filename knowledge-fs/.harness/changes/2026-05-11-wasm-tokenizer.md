# WASM Tokenizer

## Summary

- Added the Sprint 3 pure-compute tokenizer to `crates/knowledge_compute`.
- The tokenizer provides a bounded `countTokens` WASM export for Node and Workers runtime use.

## Behavior

- Exports `countTokens(input: string)` to WASM and keeps `count_tokens` native-testable in Rust.
- Uses a deterministic lightweight tokenizer:
  - contiguous ASCII alphanumeric, `_`, and `-` runs count as one token;
  - CJK and other non-whitespace graphemes count individually;
  - punctuation and emoji count as individual tokens.
- Keeps the existing `count_words` placeholder intact for compatibility.

## Performance And Safety

- Token input is bounded to 10 MiB.
- The implementation is single-pass over Unicode graphemes and keeps only scalar counters in memory.
- The tokenizer remains pure compute with no filesystem, database, cache, network, or runtime-specific dependencies.

## Verification

- RED confirmed with Rust tests failing because `count_tokens` did not exist.
- Focused verification passed:
  - `cargo test --workspace`
- Full verification passed:
  - `pnpm wasm:build`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
