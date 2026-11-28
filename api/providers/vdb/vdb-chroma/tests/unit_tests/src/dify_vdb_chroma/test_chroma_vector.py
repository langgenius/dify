import importlib
import json
import math
import sys
from collections import UserDict
from types import ModuleType
from unittest.mock import MagicMock, patch

import chromadb
import pytest

from core.rag.datasource.vdb.vector_integration_test_support import FakeModule
from core.rag.models.document import Document
from models.dataset import Dataset


def _build_fake_chroma_modules() -> FakeModule:
    chroma = FakeModule("chromadb")
    chroma.DEFAULT_TENANT = "default_tenant"
    chroma.DEFAULT_DATABASE = "default_database"

    class Settings:
        def __init__(self, **kwargs: object) -> None:
            for key, value in kwargs.items():
                setattr(self, key, value)

    class QueryResult(UserDict[str, object]):
        pass

    class _Collection:
        def __init__(self) -> None:
            self.metadata: dict[str, str] | None = None
            self.upsert = MagicMock()
            self.delete = MagicMock()
            self.query = MagicMock()
            self.get = MagicMock(return_value={})

    class _Client:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs
            self.collection = _Collection()
            self.get_or_create_collection = MagicMock(return_value=self.collection)
            self.delete_collection = MagicMock()

    chroma.Settings = Settings
    chroma.QueryResult = QueryResult
    chroma.HttpClient = _Client
    return chroma


@pytest.fixture
def chroma_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    fake_chroma = _build_fake_chroma_modules()
    monkeypatch.setitem(sys.modules, "chromadb", fake_chroma)
    import dify_vdb_chroma.chroma_vector as module

    return importlib.reload(module)


def test_chroma_config_to_params_builds_expected_payload(chroma_module: ModuleType) -> None:
    config = chroma_module.ChromaConfig(
        host="localhost",
        port=8000,
        tenant="tenant-1",
        database="db-1",
        auth_provider="provider",
        auth_credentials="credentials",
    )

    params = config.to_chroma_params()

    assert params["host"] == "localhost"
    assert params["port"] == 8000
    assert params["tenant"] == "tenant-1"
    assert params["database"] == "db-1"
    assert params["ssl"] is False
    assert params["settings"].chroma_client_auth_provider == "provider"
    assert params["settings"].chroma_client_auth_credentials == "credentials"


def test_create_collection_uses_redis_lock_and_cache(
    chroma_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(chroma_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(chroma_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(chroma_module.redis_client, "set", MagicMock())

    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    vector.create_collection("collection_1")

    vector._client.get_or_create_collection.assert_called_once_with("collection_1", metadata={"hnsw:space": "cosine"})
    chroma_module.redis_client.set.assert_called_once()


def test_add_texts_gets_collection_with_cosine_distance_metadata(chroma_module: ModuleType) -> None:
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    docs = [Document(page_content="hello", metadata={"doc_id": "d1"})]
    vector.add_texts(docs, [[0.1, 0.2]])

    vector._client.get_or_create_collection.assert_called_once_with("collection_1", metadata={"hnsw:space": "cosine"})
    vector._client.collection.upsert.assert_called_once()


def test_create_with_empty_texts_is_noop(chroma_module: ModuleType) -> None:
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    vector.create([], [])
    vector._client.get_or_create_collection.assert_not_called()


def test_create_with_texts_creates_collection_and_upserts(chroma_module: ModuleType) -> None:
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    docs = [Document(page_content="hello", metadata={"doc_id": "d1", "document_id": "doc-1"})]
    vector.create(docs, [[0.1, 0.2]])

    vector._client.get_or_create_collection.assert_called()
    vector._client.collection.upsert.assert_called_once()


def test_delete_methods_and_text_exists(chroma_module: ModuleType) -> None:
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )

    vector.delete_by_ids([])
    vector._client.collection.delete.assert_not_called()

    vector.delete_by_ids(["id-1"])
    vector._client.collection.delete.assert_called_with(ids=["id-1"])

    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.collection.delete.assert_called_with(where={"document_id": {"$eq": "doc-1"}})

    vector._client.collection.get.return_value = {"ids": ["id-1"]}
    assert vector.text_exists("id-1") is True
    vector._client.collection.get.return_value = dict[str, list[str]]()
    assert vector.text_exists("id-2") is False

    vector.delete()
    vector._client.delete_collection.assert_called_once_with("collection_1")


def test_search_by_vector_handles_empty_results(chroma_module: ModuleType) -> None:
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    empty_result: dict[str, list[object]] = {"ids": [], "documents": [], "metadatas": [], "distances": []}
    vector._client.collection.query.return_value = empty_result

    assert vector.search_by_vector([0.1, 0.2], top_k=2) == []


def test_search_by_vector_applies_score_threshold_and_sorting(chroma_module: ModuleType) -> None:
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    vector._client.collection.metadata = {"hnsw:space": "cosine"}
    vector._client.collection.query.return_value = {
        "ids": [["id-1", "id-2"]],
        "documents": [["doc high", "doc low"]],
        "metadatas": [[{"doc_id": "id-1"}, {"doc_id": "id-2"}]],
        "distances": [[0.1, 0.8]],
    }

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["doc-1"])

    assert len(docs) == 1
    assert docs[0].page_content == "doc high"
    assert docs[0].metadata["score"] == 0.9


@pytest.mark.parametrize(
    ("collection_metadata", "expected_scores"),
    [
        ({"hnsw:space": "cosine"}, [0.9, 0.2]),
        ({"hnsw:space": "ip"}, [0.9, 0.2]),
        (None, [0.95, 0.6]),
        ({"hnsw:space": "l2"}, [0.95, 0.6]),
    ],
)
def test_search_by_vector_converts_distance_by_collection_space(
    chroma_module: ModuleType, collection_metadata: dict[str, str] | None, expected_scores: list[float]
) -> None:
    """Cosine/ip distances are already 1 - similarity; squared L2 distances need 1 - distance / 2.

    Collections created before the cosine metadata was written carry no ``hnsw:space`` and
    must keep scoring through the squared L2 formula (issue #46994).
    """
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    vector._client.collection.metadata = collection_metadata
    vector._client.collection.query.return_value = {
        "ids": [["id-1", "id-2"]],
        "documents": [["doc high", "doc low"]],
        "metadatas": [[{"doc_id": "id-1"}, {"doc_id": "id-2"}]],
        "distances": [[0.1, 0.8]],
    }

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.0)

    assert [doc.metadata["score"] for doc in docs] == pytest.approx(expected_scores)


def test_search_by_full_text_returns_empty_list(chroma_module: ModuleType) -> None:
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    assert vector.search_by_full_text("query") == []


@pytest.fixture
def real_chroma_module() -> ModuleType:
    import dify_vdb_chroma.chroma_vector as module

    return importlib.reload(module)


def test_unit_vectors_scored_against_real_chroma_collections(
    real_chroma_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Reproduce issue #46994 against a real in-process Chroma.

    Unit vectors whose cosine similarities to the query are 0.95..0.2 must come back with
    scores equal to those similarities, both in a legacy collection created without
    distance metadata (Chroma's default squared L2 space) and in a collection created by
    the current code. With the old unconditional ``1 - distance`` conversion the L2
    distances collapse the scores to ``2 * cosine - 1``, so the two least similar docs
    turn negative and are dropped even at ``score_threshold=0.0``.
    """
    monkeypatch.setattr(real_chroma_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(real_chroma_module.redis_client, "set", MagicMock())

    client = chromadb.EphemeralClient(settings=chromadb.Settings(anonymized_telemetry=False))
    monkeypatch.setattr(chromadb, "HttpClient", MagicMock(return_value=client))
    legacy_vector = real_chroma_module.ChromaVector(
        collection_name="legacy_collection_1",
        config=real_chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    cosine_vector = real_chroma_module.ChromaVector(
        collection_name="cosine_collection_1",
        config=real_chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )

    cosine_similarities = [0.95, 0.8, 0.6, 0.45, 0.2]
    query_vector = [1.0, 0.0]
    embeddings = [[c, math.sqrt(1 - c * c)] for c in cosine_similarities]
    documents = [
        Document(page_content=f"doc {c}", metadata={"doc_id": f"id-{index}"})
        for index, c in enumerate(cosine_similarities)
    ]

    # Legacy collection written by an older version, without distance metadata.
    client.get_or_create_collection("legacy_collection_1")
    legacy_vector.add_texts(documents, embeddings)

    cosine_vector.create_collection("cosine_collection_1")
    cosine_vector.add_texts(documents, embeddings)

    assert client.get_collection("cosine_collection_1").metadata == {"hnsw:space": "cosine"}

    for vector in (legacy_vector, cosine_vector):
        docs = vector.search_by_vector(query_vector, top_k=5, score_threshold=0.0)
        assert [doc.metadata["doc_id"] for doc in docs] == [f"id-{index}" for index in range(5)]
        assert [doc.metadata["score"] for doc in docs] == pytest.approx(cosine_similarities, abs=1e-5)

        filtered = vector.search_by_vector(query_vector, top_k=5, score_threshold=0.7)
        assert [doc.metadata["doc_id"] for doc in filtered] == ["id-0", "id-1"]
        assert [doc.metadata["score"] for doc in filtered] == pytest.approx([0.95, 0.8], abs=1e-5)


def test_factory_init_vector_uses_existing_or_generated_collection(
    chroma_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory = chroma_module.ChromaVectorFactory()
    dataset_with_index = Dataset(
        id="dataset-1", index_struct=json.dumps({"vector_store": {"class_prefix": "EXISTING"}})
    )
    dataset_without_index = Dataset(id="dataset-2")

    monkeypatch.setattr(chroma_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_HOST", "localhost")
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_PORT", 8000)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_TENANT", None)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_DATABASE", None)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_AUTH_PROVIDER", None)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_AUTH_CREDENTIALS", None)

    with patch.object(chroma_module, "ChromaVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock(), session=None)
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock(), session=None)

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None
