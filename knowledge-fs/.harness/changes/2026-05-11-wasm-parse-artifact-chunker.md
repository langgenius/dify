# WASM Parse Artifact Chunker

## Summary

- Added the first Sprint 3 pure-compute chunker to `crates/knowledge_compute`.
- The chunker accepts parse artifact JSON and returns `KnowledgeNode`-shaped JSON for later TypeScript runtime wiring and persistence.

## Behavior

- Exports `chunkParseArtifactJson` for WASM and keeps a native-testable `chunk_parse_artifact_json` Rust function.
- Chunks text-bearing parse elements into deterministic node JSON using the parse artifact id, artifact hash, and chunk index for UUID v5 node ids.
- Keeps chunks section-aware by flushing on `sectionPath` changes.
- Splits long text on Unicode grapheme boundaries with configurable overlap.
- Maps table elements to `kind: "table"` nodes and regular text to `kind: "chunk"`.
- Carries `knowledgeSpaceId`, `documentAssetId`, `parseArtifactId`, `artifactHash`, `permissionScope`, `sourceLocation`, and bounded metadata into each node.

## Performance And Safety

- Defaults are bounded: `maxInputBytes` 10 MiB, `maxElements` 20,000, `maxChunkChars` 1,200, `overlapChars` 120, and `maxNodes` 20,000.
- Invalid config and any bound violation fail fast.
- The implementation is pure compute only: no filesystem, database, cache, network, or runtime-specific calls.

## Verification

- RED confirmed with Rust tests failing because `chunk_parse_artifact_json` did not exist.
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
