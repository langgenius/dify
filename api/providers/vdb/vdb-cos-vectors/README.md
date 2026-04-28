# Tencent Cloud COS Vectors Integration

This module integrates [Tencent Cloud COS Vectors](https://cloud.tencent.com/document/product/436)
as a vector database backend for Dify.

COS Vectors extends a COS bucket with native vector storage: each bucket can
host multiple `Index` objects, each of which stores keyed vectors together
with filterable/non-filterable metadata. Dify maps one dataset to one index
under a shared bucket.

## Mapping

| Dify concept | COS Vectors concept |
|---|---|
| Dataset (collection) | `Index` under the configured vector bucket |
| Document chunk | `Vector` keyed by `doc_id` |
| Embedding vector | `{"float32": [...]}` payload |
| Retrieval filter | `Filter` expression on vector metadata |
| Full-text search | Not supported — falls back to semantic-only |

The index name for a new dataset is derived from `Dataset.id` via
Dify's shared helper (`Dataset.gen_collection_name_by_id`), the same
rule every other vdb provider uses. The name is persisted in
`datasets.index_struct` on first write and never re-derived afterwards.

## Configuration

### Required

```bash
VECTOR_STORE=cos_vectors

COS_VECTORS_REGION=ap-guangzhou
COS_VECTORS_SECRET_ID=your_secret_id
COS_VECTORS_SECRET_KEY=your_secret_key
COS_VECTORS_BUCKET_APPID=your-vector-bucket-1250000000
```

### Optional

```bash
# Temporary STS token
COS_VECTORS_TOKEN=

# Endpoint / scheme overrides (usually not needed — leave empty to let
# the SDK pick the default public endpoint for the configured region).
# Known endpoint templates (replace {region}, e.g. ap-guangzhou):
#   Public:   vectors.{region}.coslake.com
#   Internal: vectors.{region}.internal.tencentcos.com
# The *internal* endpoint is reachable only from Tencent Cloud VPC
# resources in the same region (CVM / TKE / Lighthouse / etc.) and
# avoids public-network egress cost and latency; use it when Dify is
# deployed inside Tencent Cloud.
COS_VECTORS_SCHEME=https
COS_VECTORS_ENDPOINT=

# Index creation parameters (only used on the first write to a dataset)
COS_VECTORS_DISTANCE_METRIC=cosine        # cosine | euclidean
COS_VECTORS_DATA_TYPE=float32

# Upsert batch size for put_vectors
COS_VECTORS_MAX_UPSERT_BATCH_SIZE=500

# Metadata keys that should NOT be filterable. Keeping large blobs
# (like the raw chunk text) out of the filterable budget is recommended.
COS_VECTORS_NON_FILTERABLE_METADATA_KEYS=text
```

The vector bucket is created lazily on first use, so you only need to grant
your credentials permission to `CreateVectorBucket` / `GetVectorBucket` and
the vector index APIs. See the Tencent Cloud IAM documentation for the
exact policy statements.

## Index lifecycle

- **Create**: the first `create()` call on a dataset reads the embedding
  dimension from the first vector and issues `CreateIndex` with that
  dimension, the configured distance metric, and the configured data type.
  After that the index is immutable with respect to dimension and metric.
- **Switch embedding model / change dimension**: Dify drops and recreates
  the index automatically when the dataset is re-indexed. No manual work
  against the COS Vectors console is required.
- **Delete**: `delete()` issues `DeleteIndex` for the dataset. The shared
  vector bucket is intentionally **not** deleted, because it is shared
  across every Dify dataset in the tenant.

## Capacity planning

COS Vectors enforces a per-bucket `Index` quota (10,000 indexes per bucket
at the time of writing — see the official docs for the current number).
Because this provider maps one Dify dataset to exactly one index, the
number of indexes in your bucket is equal to the number of Dify datasets
that have ever been written to.

For self-hosted single-tenant deployments this ceiling is effectively
unreachable. For multi-tenant SaaS deployments the following should be
considered:

1. **Dify's background cleanup** (`clean_unused_datasets_task`) will drop
   indexes for datasets that (a) are older than
   `PLAN_SANDBOX_CLEAN_DAY_SETTING` / `PLAN_PRO_CLEAN_DAY_SETTING`, (b)
   have no recently updated documents, and (c) have no recent query
   activity. This reclaims most idle datasets automatically, but it does
   not reclaim datasets that are still being queried occasionally, and it
   requires the Celery Beat scheduler to be running.
2. **Explicit deletion** from the Dify UI (delete dataset / re-index
   dataset) always drops the underlying index synchronously.
3. If you expect more than ~10k active datasets per bucket, shard by
   tenant: operate multiple vector buckets (e.g. one per workspace) and
   route `COS_VECTORS_BUCKET` accordingly in your deployment.

## Operational troubleshooting

Dify is the single writer of indexes in the bucket, so the indexes you
see in the COS console should always be a subset of the rows in Dify's
`datasets` table. When investigating an unexpected index:

- **Reverse-lookup (COS index → Dify dataset).** Copy the index name
  from the COS console and run:

  ```sql
  SELECT id AS dataset_id, tenant_id, name AS dataset_name, created_at
  FROM datasets
  WHERE index_struct::jsonb -> 'vector_store' ->> 'class_prefix' = '<index_name>';
  ```

- **Orphan indexes.** If the query above returns no row, the index is
  an orphan — typically caused by an aborted delete flow or by manual
  experiments on the COS console. Orphans are safe to drop from the
  console; Dify will never read them.
- **Stuck indexes.** If the dataset row still exists but you no longer
  want the index, always delete the dataset through the Dify UI/API so
  the provider's `delete()` path runs and cleans up the related
  retrieval caches and segment tables.

## Metadata filtering

Every metadata key that is not listed in
`COS_VECTORS_NON_FILTERABLE_METADATA_KEYS` is filterable, so Dify's
`document_ids_filter` (which filters by `document_id`) works out of the
box. The only key moved to the non-filterable list by default is `text`,
because it holds the raw chunk body and would otherwise consume the
filterable-metadata size budget very quickly.

If you introduce new metadata that is large or that you never intend to
filter on, add it to the comma-separated list, e.g.:

```bash
COS_VECTORS_NON_FILTERABLE_METADATA_KEYS=text,raw_html,original_source
```

## Limitations

1. **No full-text / BM25 search.** `search_by_full_text` returns an empty
   list, so hybrid search degrades to semantic-only — same behaviour as
   the Chroma and Upstash backends.
2. **No filter-based deletion API.** `delete_by_metadata_field` first
   resolves matching vector keys by paging through `list_vectors` and
   then issues `delete_vectors` by key.
3. **Index parameters are immutable.** Dimension, distance metric, and
   data type cannot be changed after an index is created. Switching
   embedding models requires re-indexing the dataset, which Dify handles
   automatically.
4. **Per-bucket index quota.** See *Capacity planning* above.

## References

- [COS Vectors overview (CN)](https://cloud.tencent.com/document/product/436/120816)
- [Vector bucket / index APIs](https://cloud.tencent.com/document/product/436)
- [`qcloud-python-sdk`](https://github.com/tencentyun/cos-python-sdk-v5)
