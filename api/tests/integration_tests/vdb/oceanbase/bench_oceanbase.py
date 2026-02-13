"""
Benchmark: OceanBase vector store — old (single-row) vs new (batch) insertion,
metadata query with/without functional index, and vector search across metrics.

Usage:
    uv run --project api python -m tests.integration_tests.vdb.oceanbase.bench_oceanbase
"""

import json
import random
import statistics
import time
import uuid

from pyobvector import VECTOR, ObVecClient, cosine_distance, inner_product, l2_distance
from sqlalchemy import JSON, Column, String, text
from sqlalchemy.dialects.mysql import LONGTEXT

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HOST = "127.0.0.1"
PORT = 2881
USER = "root@test"
PASSWORD = "difyai123456"
DATABASE = "test"

VEC_DIM = 1536
HNSW_BUILD = {"M": 16, "efConstruction": 256}
DISTANCE_FUNCS = {"l2": l2_distance, "cosine": cosine_distance, "inner_product": inner_product}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _make_client(**extra):
    return ObVecClient(
        uri=f"{HOST}:{PORT}",
        user=USER,
        password=PASSWORD,
        db_name=DATABASE,
        **extra,
    )


def _rand_vec():
    return [random.uniform(-1, 1) for _ in range(VEC_DIM)]  # noqa: S311


def _drop(client, table):
    client.drop_table_if_exist(table)


def _create_table(client, table, metric="l2"):
    cols = [
        Column("id", String(36), primary_key=True, autoincrement=False),
        Column("vector", VECTOR(VEC_DIM)),
        Column("text", LONGTEXT),
        Column("metadata", JSON),
    ]
    vidx = client.prepare_index_params()
    vidx.add_index(
        field_name="vector",
        index_type="HNSW",
        index_name="vector_index",
        metric_type=metric,
        params=HNSW_BUILD,
    )
    client.create_table_with_index_params(table_name=table, columns=cols, vidxs=vidx)
    client.refresh_metadata([table])


def _gen_rows(n):
    doc_id = str(uuid.uuid4())
    rows = []
    for _ in range(n):
        rows.append(
            {
                "id": str(uuid.uuid4()),
                "vector": _rand_vec(),
                "text": f"benchmark text {uuid.uuid4().hex[:12]}",
                "metadata": json.dumps({"document_id": doc_id, "dataset_id": str(uuid.uuid4())}),
            }
        )
    return rows, doc_id


# ---------------------------------------------------------------------------
# Benchmark: Insertion
# ---------------------------------------------------------------------------
def bench_insert_single(client, table, rows):
    """Old approach: one INSERT per row."""
    t0 = time.perf_counter()
    for row in rows:
        client.insert(table_name=table, data=row)
    return time.perf_counter() - t0


def bench_insert_batch(client, table, rows, batch_size=100):
    """New approach: batch INSERT."""
    t0 = time.perf_counter()
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        client.insert(table_name=table, data=batch)
    return time.perf_counter() - t0


# ---------------------------------------------------------------------------
# Benchmark: Metadata query
# ---------------------------------------------------------------------------
def bench_metadata_query(client, table, doc_id, with_index=False):
    """Query by metadata->>'$.document_id' with/without functional index."""
    if with_index:
        try:
            client.perform_raw_text_sql(f"CREATE INDEX idx_metadata_doc_id ON `{table}` ((metadata->>'$.document_id'))")
        except Exception:
            pass  # already exists

    sql = text(f"SELECT id FROM `{table}` WHERE metadata->>'$.document_id' = :val")
    times = []
    with client.engine.connect() as conn:
        for _ in range(10):
            t0 = time.perf_counter()
            result = conn.execute(sql, {"val": doc_id})
            _ = result.fetchall()
            times.append(time.perf_counter() - t0)
    return times


# ---------------------------------------------------------------------------
# Benchmark: Vector search
# ---------------------------------------------------------------------------
def bench_vector_search(client, table, metric, topk=10, n_queries=20):
    dist_func = DISTANCE_FUNCS[metric]
    times = []
    for _ in range(n_queries):
        q = _rand_vec()
        t0 = time.perf_counter()
        cur = client.ann_search(
            table_name=table,
            vec_column_name="vector",
            vec_data=q,
            topk=topk,
            distance_func=dist_func,
            output_column_names=["text", "metadata"],
            with_dist=True,
        )
        _ = list(cur)
        times.append(time.perf_counter() - t0)
    return times


def _fmt(times):
    """Format list of durations as 'mean ± stdev'."""
    m = statistics.mean(times) * 1000
    s = statistics.stdev(times) * 1000 if len(times) > 1 else 0
    return f"{m:.1f} ± {s:.1f} ms"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    client = _make_client()
    client_pooled = _make_client(pool_size=5, max_overflow=10, pool_recycle=3600, pool_pre_ping=True)

    print("=" * 70)
    print("OceanBase Vector Store — Performance Benchmark")
    print(f"  Endpoint : {HOST}:{PORT}")
    print(f"  Vec dim  : {VEC_DIM}")
    print("=" * 70)

    # ------------------------------------------------------------------
    # 1. Insertion benchmark
    # ------------------------------------------------------------------
    for n_docs in [100, 500, 1000]:
        rows, doc_id = _gen_rows(n_docs)
        tbl_single = f"bench_single_{n_docs}"
        tbl_batch = f"bench_batch_{n_docs}"

        _drop(client, tbl_single)
        _drop(client, tbl_batch)
        _create_table(client, tbl_single)
        _create_table(client, tbl_batch)

        t_single = bench_insert_single(client, tbl_single, rows)
        t_batch = bench_insert_batch(client_pooled, tbl_batch, rows, batch_size=100)

        speedup = t_single / t_batch if t_batch > 0 else float("inf")
        print(f"\n[Insert {n_docs} docs]")
        print(f"  Single-row : {t_single:.2f}s")
        print(f"  Batch(100) : {t_batch:.2f}s")
        print(f"  Speedup    : {speedup:.1f}x")

    # ------------------------------------------------------------------
    # 2. Metadata query benchmark (use the 1000-doc batch table)
    # ------------------------------------------------------------------
    tbl_meta = "bench_batch_1000"
    rows_1000, doc_id_1000 = _gen_rows(1000)
    # The table already has 1000 rows from step 1; use that doc_id
    # Re-query doc_id from one of the rows we inserted
    with client.engine.connect() as conn:
        res = conn.execute(text(f"SELECT metadata->>'$.document_id' FROM `{tbl_meta}` LIMIT 1"))
        doc_id_1000 = res.fetchone()[0]

    print("\n[Metadata filter query — 1000 rows, by document_id]")
    times_no_idx = bench_metadata_query(client, tbl_meta, doc_id_1000, with_index=False)
    print(f"  Without index : {_fmt(times_no_idx)}")
    times_with_idx = bench_metadata_query(client, tbl_meta, doc_id_1000, with_index=True)
    print(f"  With index    : {_fmt(times_with_idx)}")

    # ------------------------------------------------------------------
    # 3. Vector search benchmark — across metrics
    # ------------------------------------------------------------------
    print("\n[Vector search — top-10, 20 queries each, on 1000 rows]")

    for metric in ["l2", "cosine", "inner_product"]:
        tbl_vs = f"bench_vs_{metric}"
        _drop(client_pooled, tbl_vs)
        _create_table(client_pooled, tbl_vs, metric=metric)
        # Insert 1000 rows
        rows_vs, _ = _gen_rows(1000)
        bench_insert_batch(client_pooled, tbl_vs, rows_vs, batch_size=100)
        times = bench_vector_search(client_pooled, tbl_vs, metric, topk=10, n_queries=20)
        print(f"  {metric:15s}: {_fmt(times)}")
        _drop(client_pooled, tbl_vs)

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    for n in [100, 500, 1000]:
        _drop(client, f"bench_single_{n}")
        _drop(client, f"bench_batch_{n}")

    print("\n" + "=" * 70)
    print("Benchmark complete.")
    print("=" * 70)


if __name__ == "__main__":
    main()
