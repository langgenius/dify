# KnowledgeFS vector collection names

The Dify vector bridge writes a collection per vector scope using
`knowledgefs_v1_<kind>_<hash>`:

| Vector kind | Collection prefix |
| --- | --- |
| Document text | `knowledgefs_v1_dense_` |
| Visual content | `knowledgefs_v1_visual_` |
| Graph entities | `knowledgefs_v1_graph_entity_` |
| Graph relations | `knowledgefs_v1_graph_relation_` |

The hash is the first 32 hexadecimal characters of SHA-256 over the canonical
JSON scope: tenant ID, knowledge space ID, vector space ID, vector kind, and
dimension. UUIDs are normalized to lowercase; keys are sorted and JSON has no
optional whitespace. The longest collection name is 62 characters, within
TiDB's 64-character table-name limit. Weaviate capitalizes the initial `K` to
meet its class-name requirements.

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
