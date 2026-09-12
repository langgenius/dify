# Knowledge graph (GraphRAG) for the built-in knowledge base

Entities and relations are extracted from a knowledge base's chunks at index
time, and retrieval walks them so a question about one document can reach an
answer several documents away. Every fact keeps a link back to the
`DocumentSegment` it came from, so a graph hit is cited exactly like a vector
hit.

The graph is an enhancement layer over the regular index. It never replaces
vector or full-text retrieval, and it is never allowed to break them: an
extraction failure leaves a chunk searchable through the other legs, and a graph
backend outage skips the graph leg instead of failing the query.

## Turning it on

Per knowledge base, under **Settings → Knowledge Graph**: enable it and pick an
extraction model. Nothing happens to documents already indexed — the graph is
built as documents are indexed, so re-index the documents you want covered.

Retrieval uses the graph for `hybrid_search` and `keyword_search`, and only for
knowledge bases that opted in.

## Cost

Indexing calls the extraction model **once per chunk**, and again whenever a
document is re-indexed. A 100,000-chunk knowledge base is 100,000 calls; budget
for that before enabling it on a large one.

`KNOWLEDGE_GRAPH_EXTRACTION_WORKERS` caps how many of those calls a worker
process makes at a time (default 5), across every indexing task it is running.
Total concurrency is therefore that number times the number of deployed workers.

At query time the graph is free when the question names something the graph
knows: entity lookup is a plain database probe. When it names nothing, the
**Query Fallback** switch decides whether to spend one model call asking which
entities the question mentions. Turn it off to make graph retrieval cost nothing
at all.

## Choosing a backend

`GRAPH_STORE` selects the backend for the whole deployment; it is not a
per-knowledge-base choice.

### `postgres` (default)

Stores the graph in Dify's own metadata database (`dataset_graph_entities`,
`dataset_graph_relations`, `dataset_graph_chunk_links`). Needs no extra service
and inherits the existing backups and tenant isolation. This is the right choice
unless you already run Neo4j.

### `neo4j`

```bash
uv sync --group graph-neo4j
```

```bash
GRAPH_STORE=neo4j
KNOWLEDGE_GRAPH_NEO4J_URI=bolt://neo4j:7687
KNOWLEDGE_GRAPH_NEO4J_USER=neo4j
KNOWLEDGE_GRAPH_NEO4J_PASSWORD=...
KNOWLEDGE_GRAPH_NEO4J_DATABASE=neo4j
```

One Neo4j instance serves every knowledge base: nodes and edges are namespaced
by `dataset_id`. The constraints and indexes the backend needs are created on
first use.

Switching `GRAPH_STORE` does not migrate anything. The graphs written by the old
backend stay where they are and stop being read; re-index the documents to
rebuild them in the new one. (Deleting a knowledge base clears both, so
switching backends does not strand rows forever.)

## Other settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `GRAPH_STORE` | `postgres` | Backend storing the graph. |
| `KNOWLEDGE_GRAPH_EXTRACTION_WORKERS` | `5` | Concurrent extraction calls per worker process. |
| `KNOWLEDGE_GRAPH_INDEX_LOCK_TIMEOUT` | `600` | Seconds a worker may hold a knowledge base's merge lease. Renewed between phases. |
| `KNOWLEDGE_GRAPH_INDEX_LOCK_WAIT` | `60` | Seconds a worker waits for another worker's lease before giving up. |

## Limitations

- **Document content is untrusted input.** It reaches the extraction prompt
  verbatim, and the entities and relations that come back are persisted without
  a confidence gate, so a crafted document can plant edges that later act as
  false multi-hop bridges. Facts never cross knowledge bases, and each one is
  traceable to its source chunk, so a suspect bridge can be followed back.
- **Re-indexing is the only rebuild.** A chunk whose extraction failed (model
  unavailable, unparsable answer) is skipped with a warning and has no graph
  facts until its document is indexed again.
- **`graph_search` is not offered as a standalone retrieval mode in the
  console.** The value is a merged result set, so the graph runs as one leg of
  hybrid and keyword search rather than on its own. The enum member exists for
  callers that build a retrieval config directly.
- **Entity name lookup is a substring scan.** Seed matching uses
  `LIKE '%term%'`, which no btree index can serve; a trigram index would need
  the `pg_trgm` extension, which cannot be assumed. Large graphs pay for this at
  query time.
