# Graph semantic query implementation

## Contract

Graph retrieval must have an entry point independent of document recall. Entity and relation
localization combine exact/alias, lexical and semantic candidates. Semantic similarity is not an
identity assertion or a fact: a bounded, grounded query plan selects actual entity IDs, relation
types, directions and per-hop constraints; execution returns only existing authorized paths.

Existing Fast retrieval and legacy graph traversal remain compatible. Deep/Research use the new
capability when a frozen embedding/reasoning profile is available. Queries never generate document
or graph embeddings on demand. Old graphs need re-indexing to obtain semantic projections; missing
projections must be observable rather than reported as full semantic coverage.

## Iterations

- [x] Add a versioned relation catalog and bounded query/path contracts.
- [x] Add migration 0054 and graph-only semantic projections. Reuse the knowledge-space embedding
      model; bind vectors to immutable fact content, generation, vector-space and dimension.
- [x] Materialize projections during ingestion/profile rebuilding, with bounded batches and reuse
      of identical embedding inputs. Preserve graph facts and existing publication fences.
- [x] Add publication/ACL-scoped exact, lexical and vector candidate retrieval for entities and
      relation types. Never rank forbidden graph facts and then filter them after the Top K.
- [x] Add a grounded planner and constrained forward/reverse, per-hop path execution, with cycle,
      fanout, hop, path and deadline budgets. A truncated search is not proof of absence.
- [x] Integrate independent graph recall into Deep/Research and expose path evidence and coverage.
      Keep model budgets, cancellation, selected-document filters and legacy behavior intact.
- [x] Add migration, indexing, grounding, direction/multi-hop, permission and retrieval regression
      tests; run package type checks, lint, migration registry and Dify contract checks.

## Implemented behavior

1. Retrieve bounded entity candidates using names/aliases, multilingual lexical terms and cosine
   similarity against entity descriptions/context. Match relation intent against the versioned,
   bilingual predicate definitions; deduplicate predicate candidates before vector scoring.
2. Use the frozen reasoning model to select only authorized candidate IDs and predicates, ordered
   steps, direction, hop ranges and optional endpoint entity/type constraints. One graph planning
   call per request, only on the primary Research leg, sharing existing model admission/accounting.
3. Execute existing directed edges with independent bounds: at most four steps and six total hops;
   defaults of 12 edges per entity/direction, 96 frontier paths, 24 result paths and 1,024 examined
   edge/path combinations. Planning deadline: 20 seconds; path deadline: 5 seconds; overall graph
   deadline: 30 seconds. Parent cancellation and the existing Research deadline still apply.
4. Recall source passages independently of base retrieval seeds, intersect the caller's document
   filters, and preserve existing final reranking. Supply graph paths to text/visual synthesis only
   when every edge retains source citations after final filtering. Similarity never creates a fact.

The catalog retains all six original predicates and adds `responsible_for`, `member_of`,
`reports_to`, `part_of`, `owns`, `provides`, `uses` and `collaborates_with`. Extraction/checkpoint
versions are advanced so retries cannot reuse an old-schema answer as a new-schema extraction.
The HTTP response schema and standalone admin client accept the same catalog, with cross-layer tests.

New graph embeddings use `search_document`, the space's frozen embedding model/vector-space and
publication generation. Batches reuse hashes and identical predicate embeddings within a document;
they share ingestion admission budgets and the provider's existing concurrency gate. Owner deletion
cascades to semantic projections. No external graph database, extra model setting or new worker is
required. Semantic enrichment lease loss propagates cancellation through model calls and indexing.

## Boundaries and observability

- Metadata carries versioned `graphQuery` / `graphPaths`; existing graph-stage metrics include
  planning/traversal time and examined edges. Explicit degradation flags distinguish missing/partial
  semantic indexes, ambiguity, deadlines, bounded truncation and incomplete source evidence.
- Missing/failed graph capability does not silently assert absence: base document retrieval remains
  available. Model-usage accounting failures and caller cancellation still propagate as failures.
- Plans do not join disconnected entities simply because names or vectors are similar. Cross-document
  identity resolution and arbitrary graph query languages/aggregation are not implemented here.
- Multi-hop execution follows the actual persisted IDs/edges within published generations. New
  semantic lookup does not expand the legacy graph-browse endpoint's existing depth limit.
- Vector scoring is an exact scoped scan, not an ANN index. SQL has a five-second deadline; this
  implementation is not a claim of latency at unbounded graph scale. Load-test representative
  graph sizes before raising budgets or rollout concurrency.

## Verification and rollout

Apply 0054 before running the new build. New/re-indexed documents receive semantic projections;
existing documents retain lexical/legacy retrieval until re-indexed. Re-indexing is also required
to extract the newly supported predicates from old source material. Model changes rebuild graph
vectors together with their frozen publication candidates. Deployment, bulk re-indexing, commit and
push are separate operations and are not performed by this implementation task.

Verification covers API/database/API-app/admin regressions, type checks, changed-file Biome checks,
production API/Celery bundles, migration registry consistency and Dify contract generation/tests.
Embedded PostgreSQL + pgvector tests execute migration 0054 twice and test actual SQL writes,
semantic/lexical reads, ACL/source/document/generation fences, multi-hop paths and deletion cleanup.
TiDB has DDL/SQL generation tests, not a live TiDB execution test; production model relevance and
staging rollout have not been evaluated by these synthetic tests.
