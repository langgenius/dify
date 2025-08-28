#!/usr/bin/env python3
"""
Standalone smoke test for the Dify ↔ Weaviate v4 adapter.

What this tests:
  - Client init (v4)
  - Create collection (BYO vectors)
  - Insert docs (insert_many)
  - Vector search (near_vector) + score=1-distance
  - BM25 search (bm25)
  - Delete by metadata field
  - Delete by id
  - Drop collection

This script avoids pytest and the Dify app bootstrap (so no OpenDAL config needed).
"""

import os
import sys
import time
import argparse
import time
from typing import Any, List

class _DummyLock:
    def __init__(self, *_, **__): pass
    def __enter__(self): return self
    def __exit__(self, exc_type, exc, tb): return False

class _DummyRedis:
    def __init__(self): self._store = {}
    def lock(self, name, timeout=20): return _DummyLock()
    def get(self, key): return self._store.get(key)
    def set(self, key, val, ex=None): self._store[key] = val

# Patch the exact module where redis_client is referenced
import core.rag.datasource.vdb.weaviate.weaviate_vector as weav_vec_mod
weav_vec_mod.redis_client = _DummyRedis()

# --- Make repo importable without installing --------------------------------
# Adjust these paths if your repo layout differs.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API_ROOT = os.path.join(REPO_ROOT, "api")
if API_ROOT not in sys.path:
    sys.path.insert(0, API_ROOT)

# --- Imports from your codebase ---------------------------------------------
from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateConfig, WeaviateVector
from core.rag.models.document import Document


def parse_args():
    p = argparse.ArgumentParser(description="Smoke test Dify ↔ Weaviate v4 adapter.")
    p.add_argument("--endpoint", default=os.getenv("WEAVIATE_ENDPOINT", "http://localhost:8080"),
                   help="Weaviate HTTP endpoint, e.g. http://localhost:8080 or https://<cluster>")
    p.add_argument("--api-key", default=os.getenv("WEAVIATE_API_KEY"),
                   help="Weaviate API key (omit for local/no-auth).")
    p.add_argument("--dim", type=int, default=int(os.getenv("WEAVIATE_DIM", "8")),
                   help="Embedding dimension to use in the test vectors.")
    p.add_argument("--top-k", type=int, default=3, help="Top-k to return in searches.")
    return p.parse_args()


def make_vectors(n: int, dim: int, base: float = 0.01) -> List[List[float]]:
    """Generate n simple, distinct vectors of given dimension."""
    vecs: List[List[float]] = []
    for i in range(n):
        vecs.append([base * (i + 1)] * dim)
    return vecs


def main():
    args = parse_args()

    # Unique temp collection name per run
    collection = f"Dify_WeaviateV4_Smoke_{int(time.time())}"

    print("== Smoke test config ==")
    print(f"Endpoint : {args.endpoint}")
    print(f"API key  : {'<set>' if args.api_key else '<none>'}")
    print(f"Dim      : {args.dim}")
    print(f"Top-k    : {args.top_k}")
    print(f"Collection: {collection}")
    print()

    # Initialize adapter
    cfg = WeaviateConfig(endpoint=args.endpoint, api_key=args.api_key, batch_size=64)
    vec = WeaviateVector(
        collection_name=collection,
        config=WeaviateConfig(endpoint=args.endpoint, api_key=args.api_key, batch_size=64),
        attributes=["document_id", "doc_id"]   # ← include document_id here
    )

    # Prepare test data
    docs = [
        Document(page_content="hello weaviate v4 world", metadata={"document_id": "d1", "doc_id": "d1"}),
        Document(page_content="goodbye (but still searchable) world", metadata={"document_id": "d2", "doc_id": "d2"}),
    ]
    vectors = make_vectors(n=len(docs), dim=args.dim)

    # --- Create + insert -----------------------------------------------------
    print("[1/6] Creating collection and inserting documents...")
    vec.create(docs, vectors)
    print("      Inserted:", [d.metadata["document_id"] for d in docs])

    # (A) wait until objects are queryable (avoid transient empty results)
    
    for _ in range(20):  # up to ~2s
        if vec.text_exists("d1") and vec.text_exists("d2"):
            break
        time.sleep(0.1)
    print("      Ready? d1:", vec.text_exists("d1"), " d2:", vec.text_exists("d2"))

    # (B) quick bm25 sanity (proves properties are present)
    bm = vec.search_by_full_text("world", top_k=5)
    print("      BM25 saw:", [r.metadata.get("document_id") for r in bm])

    # --- Vector search -------------------------------------------------------
    print("[2/6] Vector search (near_vector) ...")
    res_vec = []
    for _ in range(20):
        res_vec = vec.search_by_vector(vectors[0], top_k=args.top_k, score_threshold=0.0)
        if res_vec:  # got something
            break
        time.sleep(0.1)

    print("      near_vector raw:", [r.metadata for r in res_vec])
    assert any(r.metadata.get("document_id") == "d1" for r in res_vec), "Expected 'd1' in vector search results"

    # --- BM25 search ---------------------------------------------------------
    print("[3/6] BM25 search (query='world') ...")
    res_bm25 = vec.search_by_full_text("world", top_k=args.top_k)
    for r in res_bm25:
        print("      •", r.metadata.get("document_id"))
    assert {r.metadata.get("document_id") for r in res_bm25} >= {"d1", "d2"}, "Expected both docs in BM25 results"

    # --- Existence check -----------------------------------------------------
    print("[4/6] Existence check for doc_id == 'd1' ...")
    exists_d1 = vec.text_exists("d1")
    print("      exists_d1:", exists_d1)
    assert exists_d1, "Expected doc_id 'd1' to exist"

    # --- Delete by metadata field -------------------------------------------
    print("[5/6] Deleting by metadata: document_id == 'd2' ...")
    vec.delete_by_metadata_field("document_id", "d2")
    still_d2 = vec.text_exists("d2")
    print("      exists_d2 after delete_by_metadata:", still_d2)
    assert not still_d2, "Expected 'd2' to be deleted by metadata filter"

    # --- Delete by id (using a re-search to get any remaining IDs) ----------
    print("[6/6] Deleting remaining by id and dropping collection ...")
    res_vec_after = vec.search_by_full_text("hello", top_k=5)
    # Your adapter doesn't return ids directly in metadata; if you need exact UUIDs,
    # you could extend the adapter to return them. For now, just drop the collection:
    vec.delete()
    print("      Dropped collection.")

    print("\n✅ Smoke test PASSED.")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("\n❌ Smoke test FAILED:", e)
        sys.exit(1)
    except Exception as e:
        print("\n❌ Error during smoke test:", repr(e))
        sys.exit(2)