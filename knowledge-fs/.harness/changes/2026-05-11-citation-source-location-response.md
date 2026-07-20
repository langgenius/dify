# Citation Source Location Response

## What Changed

- Extended hybrid retrieval results with citation source-location data.
- Each fused retrieval item now includes document asset id, document version, artifact hash, page number, section path, and start/end offsets.
- Dense and FTS retrieval queries now join `index_projections` to `knowledge_nodes` and `parse_artifacts` in the same bounded query.
- Added tests proving citation fields are returned, PostgreSQL SQL joins the required tables, TiDB retrieval still uses vector/FTS primitives, and guardrails remain covered.

## Why

- Sprint 3 requires retrieval output to be citation-ready before EvidenceBundle and answer generation work begins.
- Joining node/artifact metadata during retrieval avoids N+1 lookups after candidate recall.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`: passed.
- `pnpm --filter @knowledge/api test:coverage`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks And Follow-Up

- This slice exposes citation metadata through the retrieval boundary only; no public query API or EvidenceBundle persistence is added yet.
- Citation scoring and evidence packing remain later Phase 2/Sprint work.
