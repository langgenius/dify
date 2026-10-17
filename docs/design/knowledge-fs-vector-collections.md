# KnowledgeFS vector collection names

The Dify vector bridge writes a collection per vector scope using
`knowledgefs_v1_<kind>_<hash>`:

| Vector kind | Collection prefix |
| --- | --- |
| Document text | `knowledgefs_v1_dense_` |
| Visual content | `knowledgefs_v1_visual_` |
| Graph entities | `knowledgefs_v1_graph_entity_` |
| Graph relations | `knowledgefs_v1_graph_relation_` |

The hash is a hexadecimal SHA-256 prefix over the canonical JSON scope: tenant
ID, knowledge space ID, vector space ID, vector kind, and dimension. UUIDs are
normalized to lowercase; keys are sorted and JSON has no optional whitespace.
The suffix uses up to 32 characters while keeping the entire name at most 56
characters: 32 for dense/visual, 28 for graph entities, and 26 for graph relations
(at least 104 bits). The deployed TiDB-on-Qdrant gateway accepts longer names on
write and search but returns 404 from point deletion for names over 56 characters;
TiDB's SQL table-name limit alone is insufficient. Weaviate capitalizes the
initial `K` to meet its class-name requirements.

## Existing collections

Earlier versions used `knowledgefs_v1_<40-character hash>`. New writes use the
typed name. Reads and searches include both names, deduplicate point IDs, and
apply the original authorized-ID filter in each collection. The search limit
is applied again after merging results. Point reads prefer the typed collection
when a point exists in both; vectors are immutable under their point IDs.

Deletion removes and verifies the requested IDs in both collections before
acknowledging success. A backend error in either collection fails the request;
only an explicit missing collection is ignored. Search still fails if neither
collection exists.

Deployment does not rename, copy, or delete existing collections. Existing
documents continue to work without re-embedding or re-uploading. Empty legacy
collections can be retired separately after verifying no live SQL receipts
reference their points. The TiDB-on-Qdrant database name remains unchanged.

## TiDB-on-Qdrant filtering

This gateway rejects Qdrant's `HasIdCondition`. New, empty collections receive a
keyword index on `knowledgefs_point_id`; writes copy the immutable point ID into
that payload field. Search uses a `FieldCondition` with `MatchAny` and requests
payloads because the gateway's filtered SQL fails when payload selection is
disabled. Only IDs and scores are returned by the bridge. Unexpected IDs fail
the entire request.

Collections without that index remain readable. Their search path retrieves
only the SQL-authorized IDs and computes exact cosine scores. Each request is
bounded to 2048 IDs, 64 points per read, and four concurrent reads. This legacy
path transfers vectors and is slower than indexed search, but requires no
re-embedding or mutation during a read. An index is initialized automatically
only while a collection is empty, so adding it cannot hide older points that
lack the ID payload. Nonempty collections require a separate complete backfill
before enabling the indexed path.

The gateway also acknowledges multi-ID `PointIdsList` deletion without removing
the points. Indexed collections therefore delete through the same ID field
filter. Unindexed collections delete one authorized ID per call, with at most
four concurrent calls. Both paths still verify absence before acknowledging
cleanup, and any failed or uncertain operation remains retryable.
If a legacy collection has no payload indexes at all, deletion first initializes
a keyword index on its existing `content_hash` field: the gateway otherwise
fails to parse empty index metadata. This does not rewrite vectors or enable
the new indexed-search path for points without an ID payload.
