# Graph-expansion tuning via environment variables

Date: 2026-07-08

Makes the deep/research graph-expanded-retrieval knobs deployable configuration instead of
hardcoded literals. Global env defaults now; a per-space overlay (a small set of taste knobs in the
space manifest, clamped to these env ceilings) stays a possible later step — latency/traversal knobs
remain ops-only by design.

## What changed
- New `apps/api/src/graph-expansion-options.ts`:
  - `createApiGraphExpansionOptions(env)` reads `KNOWLEDGE_GRAPH_EXPANSION*` vars; returns
    `undefined` when `KNOWLEDGE_GRAPH_EXPANSION=off|false|0` (kill switch — the retriever then
    skips the graph wrapper entirely). Invalid values fail startup fast, naming the variable;
    `MAX_DEPTH` is bounded 1-2 to match `validateGraphTraversalInput`.
  - `DEFAULT_GRAPH_EXPANSION_OPTIONS` is the single source of the former hardcoded defaults
    (fanout 20, boost 0.2, topK 10, depth 2, seeds 5, nodes 50, timeout 250ms).
- `createApiRetriever` gains optional `graphExpansion` (falls back to the shared defaults);
  `apps/api/index.ts` wires the env factory and only passes `graph` when expansion is enabled.
- `.env.example` documents the new variables with defaults.

## Env vars
KNOWLEDGE_GRAPH_EXPANSION (off switch), _MAX_DEPTH (1-2), _FANOUT, _MAX_SEED_ENTITIES,
_MAX_TRAVERSAL_NODES, _GRAPH_TOP_K, _GRAPH_BOOST (float > 0), _TIMEOUT_MS.

## Tests
- `graph-expansion-options.test.ts`: defaults, off-switch variants, full override parsing,
  invalid-value errors (incl. depth bound).
- `retriever-options.test.ts`: custom knobs reach `graph.traverse` (fanout/maxDepth/maxNodes/
  timeoutMs); existing deep/fast gating tests updated to the richer spy.
