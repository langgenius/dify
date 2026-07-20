# Graph-expanded retrieval in deep mode

Date: 2026-07-07

Activates the previously-dormant `createGraphExpandedRetrievalPath` (GraphRAG-style: seed entities
from base hits → traverse the knowledge graph → re-retrieve boosted by related entity names) for
`deep` mode, and closes the missing link that made it inert.

## What changed
1. **`shouldRunModeExtension`** (`retrieval-paths.ts`): `deep` now enables `graph-expansion` (it was
   only reachable via `research`, and never wired at all).
2. **`createApiRetriever`** (`apps/api/retriever-options.ts`): wraps the retrieval stack with
   `createGraphExpandedRetrievalPath` as the OUTERMOST layer when a graph repo is provided — it seeds
   from the fully composed results and runs once per query, no-op'ing unless the mode enables it.
   `apps/api/index.ts` passes `repositoryOptions.graphIndex`.
3. **Seed linkage back-reference** (`graph-index-writer.ts`): the writer now patches each source
   node's metadata with the `graphEntityIds` it maps to, after upserting entities. This is the piece
   that was missing — the seed reader (`graphSeedEntityIdsFromItems`) reads `graphEntityIds` from a
   retrieved node's metadata, but nothing wrote it. It runs as the last node-mutating ingest step, so
   nothing overwrites it.

## Data flow (now complete)
ingest → entity extraction writes `extractedEntities` → graph writer upserts entities AND writes
`graphEntityIds` back onto nodes → retrieval carries `nodeMetadata.graphEntityIds` on each hit → deep
query: graph path reads those ids, traverses, re-retrieves boosted, merges.

## Requires a reindex to take effect
Existing graphs were built before the back-reference existed, so their nodes lack `graphEntityIds`.
Graph expansion stays inert for a space until its documents are reindexed (which also requires
`semanticEntityExtractionProvider` to be configured — no provider ⇒ no graph ⇒ nothing to expand).

## Defaults (deep mode)
maxSeedEntities 5, maxDepth 2, fanout 20, maxTraversalNodes 50, graphTopK 10, graphBoost 0.2,
timeoutMs 250 (all within `validateGraphExpandedRetrievalOptions` bounds).

## Tests
- `graph-index.test.ts`: asserts source nodes receive `graphEntityIds` (merged onto existing
  metadata) after indexing.
- `retriever-options.test.ts`: deep mode seeds graph traversal from a hit's entity id; fast mode does
  not traverse.
