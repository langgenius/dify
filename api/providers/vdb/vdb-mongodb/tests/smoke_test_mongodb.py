"""
Smoke test for MongoDBVector against a real mongodb-atlas-local container.

Prerequisites:
    docker run -d --name mongodb-atlas-local -p 27017:27017 mongodb/mongodb-atlas-local:latest

Run (from repo root):
    uv run --project api python api/providers/vdb/vdb-mongodb/tests/smoke_test_mongodb.py
"""

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

_api_root = str(Path(__file__).resolve().parents[4])
if _api_root not in sys.path:
    sys.path.insert(0, _api_root)

from pymongo import MongoClient
from pymongo.operations import SearchIndexModel

MONGO_URI = "mongodb://localhost:27017/?directConnection=true"
DATABASE = "dify_smoke_test"
COLLECTION = "smoke_vectors"
INDEX_NAME = "vector_index"
VECTOR_DIM = 128


def check_connectivity() -> None:
    print("[1/5] Checking connectivity...")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    print("       Connected to MongoDB successfully.")
    client.close()


def test_raw_pymongo_vector_search() -> None:
    print("[2/5] Testing raw pymongo vector search pipeline...")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client[DATABASE]

    db.drop_collection(COLLECTION)

    col = db[COLLECTION]
    vec_a = [1.0 if i < VECTOR_DIM // 2 else 0.0 for i in range(VECTOR_DIM)]
    vec_b = [0.0 if i < VECTOR_DIM // 2 else 1.0 for i in range(VECTOR_DIM)]
    vec_c = [0.5] * VECTOR_DIM

    col.insert_many(
        [
            {
                "text": "The quick brown fox",
                "embedding": vec_a,
                "metadata": {"doc_id": "doc1"},
                "group_id": "g1",
            },
            {
                "text": "Jumped over the lazy dog",
                "embedding": vec_b,
                "metadata": {"doc_id": "doc2"},
                "group_id": "g1",
            },
            {
                "text": "Unrelated document in another group",
                "embedding": vec_c,
                "metadata": {"doc_id": "doc3"},
                "group_id": "g2",
            },
        ]
    )

    model = SearchIndexModel(
        definition={
            "fields": [
                {"type": "vector", "path": "embedding", "numDimensions": VECTOR_DIM, "similarity": "cosine"},
                {"type": "filter", "path": "group_id"},
            ]
        },
        name=INDEX_NAME,
        type="vectorSearch",
    )
    col.create_search_index(model=model)
    print("       Vector search index created. Waiting for it to become queryable...")

    for i in range(30):
        indexes = list(col.aggregate([{"$listSearchIndexes": {"name": INDEX_NAME}}]))
        if indexes and indexes[0].get("queryable"):
            print(f"       Index ready after ~{i + 1}s.")
            break
        time.sleep(1)
    else:
        print("       WARNING: Index did not become queryable in 30s, trying search anyway...")

    results = list(
        col.aggregate(
            [
                {
                    "$vectorSearch": {
                        "index": INDEX_NAME,
                        "path": "embedding",
                        "queryVector": vec_a,
                        "numCandidates": 10,
                        "limit": 3,
                        "filter": {"group_id": "g1"},
                    }
                },
                {"$project": {"text": 1, "score": {"$meta": "vectorSearchScore"}}},
            ]
        )
    )

    assert len(results) == 2, f"Expected 2 results (group g1 only), got {len(results)}: {results}"
    assert results[0]["text"] == "The quick brown fox", f"Expected closest match first, got: {results[0]}"
    print(f"       Vector search returned {len(results)} results (filtered to group g1):")
    for r in results:
        print(f"         - \"{r['text']}\" (score: {r['score']:.4f})")

    db.drop_collection(COLLECTION)
    client.close()


def test_mongodb_vector_class() -> None:
    print("[3/5] Testing MongoDBVector class: create + add_texts...")
    from dify_vdb_mongodb.mongodb_vector import MongoDBVector

    from core.rag.models.document import Document

    pre_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    pre_client.drop_database(f"{DATABASE}_class")
    pre_client.close()

    config = MagicMock()
    config.MONGODB_CONNECT_URI = MONGO_URI
    config.MONGODB_DATABASE = f"{DATABASE}_class"
    config.MONGODB_VECTOR_INDEX_NAME = INDEX_NAME
    config.MONGODB_SERVER_SELECTION_TIMEOUT_MS = 5000
    config.MONGODB_CONNECTION_RETRY_ATTEMPTS = 3
    config.MONGODB_CONNECTION_RETRY_BACKOFF_BASE = 0.5
    config.MONGODB_CONNECTION_RETRY_MAX_WAIT = 5.0
    config.MONGODB_INDEX_READY_TIMEOUT = 60
    config.MONGODB_INDEX_READY_CHECK_DELAY = 1.0
    config.MONGODB_INDEX_READY_MAX_DELAY = 3.0

    vector = MongoDBVector("smoke_collection", "group_test", config)
    print("       MongoDBVector initialized against real MongoDB.")

    emb_ai = [1.0 if i < VECTOR_DIM // 2 else 0.0 for i in range(VECTOR_DIM)]
    emb_ml = [0.0 if i < VECTOR_DIM // 2 else 1.0 for i in range(VECTOR_DIM)]

    docs = [
        Document(page_content="First document about AI", metadata={"doc_id": "d1"}),
        Document(page_content="Second document about ML", metadata={"doc_id": "d2"}),
    ]
    embeddings = [emb_ai, emb_ml]

    vector.create(docs, embeddings)
    print("       Collection created, index built, documents inserted.")

    print("[4/5] Testing MongoDBVector class: search_by_vector...")
    print("       Waiting for index to catch up with inserted data...")
    time.sleep(3)
    results = vector.search_by_vector(emb_ai, top_k=2)
    assert len(results) > 0, "Expected at least one search result"
    print(f"       Search returned {len(results)} results:")
    for r in results:
        print(f"         - \"{r.page_content}\" (score: {r.metadata.get('score', 'N/A'):.4f})")

    assert results[0].page_content == "First document about AI", f"Unexpected top result: {results[0].page_content}"

    print("[5/5] Testing MongoDBVector class: delete + text_exists...")
    assert vector.text_exists("d1"), "Expected doc d1 to exist"
    vector.delete_by_ids(["d1"])
    assert not vector.text_exists("d1"), "Expected doc d1 to be deleted"
    print("       Delete and existence check passed.")

    vector.delete()
    client = MongoClient(MONGO_URI)
    client.drop_database(f"{DATABASE}_class")
    client.close()


def cleanup() -> None:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.drop_database(DATABASE)
    client.drop_database(f"{DATABASE}_class")
    client.close()


def _can_import_dify_modules() -> bool:
    try:
        from dify_vdb_mongodb.mongodb_vector import MongoDBVector  # noqa: F401

        from core.rag.models.document import Document  # noqa: F401

        return True
    except ImportError:
        return False


def main() -> None:
    print("=" * 60)
    print("MongoDB Atlas Local — Smoke Test")
    print("=" * 60)
    try:
        check_connectivity()
        test_raw_pymongo_vector_search()

        if _can_import_dify_modules():
            test_mongodb_vector_class()
        else:
            print()
            print("[3-5/5] SKIPPED — Dify packages not on sys.path.")
            print("       Run with:  uv run --project api python api/providers/vdb/vdb-mongodb/tests/smoke_test_mongodb.py")

        print()
        print("ALL SMOKE TESTS PASSED")
    except Exception as e:
        print(f"\nSMOKE TEST FAILED: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
    finally:
        try:
            cleanup()
        except Exception as e:
            print(f"\nWARNING: cleanup failed: {e}")


if __name__ == "__main__":
    main()
