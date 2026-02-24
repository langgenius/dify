import importlib
import sys
import types
from collections import UserDict
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_chroma_modules():
    chroma = types.ModuleType("chromadb")
    chroma.DEFAULT_TENANT = "default_tenant"
    chroma.DEFAULT_DATABASE = "default_database"

    class Settings:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    class QueryResult(UserDict):
        pass

    class _Collection:
        def __init__(self):
            self.upsert = MagicMock()
            self.delete = MagicMock()
            self.query = MagicMock()
            self.get = MagicMock(return_value={})

    class _Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.collection = _Collection()
            self.get_or_create_collection = MagicMock(return_value=self.collection)
            self.delete_collection = MagicMock()

    chroma.Settings = Settings
    chroma.QueryResult = QueryResult
    chroma.HttpClient = _Client
    return chroma


@pytest.fixture
def chroma_module(monkeypatch):
    fake_chroma = _build_fake_chroma_modules()
    monkeypatch.setitem(sys.modules, "chromadb", fake_chroma)
    import core.rag.datasource.vdb.chroma.chroma_vector as module

    return importlib.reload(module)


def test_chroma_config_to_params_builds_expected_payload(chroma_module):
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


def test_create_collection_uses_redis_lock_and_cache(chroma_module, monkeypatch):
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

    vector._client.get_or_create_collection.assert_called_once_with("collection_1")
    chroma_module.redis_client.set.assert_called_once()


def test_create_with_empty_texts_is_noop(chroma_module):
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    vector.create([], [])
    vector._client.get_or_create_collection.assert_not_called()


def test_create_with_texts_creates_collection_and_upserts(chroma_module):
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    docs = [Document(page_content="hello", metadata={"doc_id": "d1", "document_id": "doc-1"})]
    vector.create(docs, [[0.1, 0.2]])

    vector._client.get_or_create_collection.assert_called()
    vector._client.collection.upsert.assert_called_once()


def test_delete_methods_and_text_exists(chroma_module):
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
    vector._client.collection.get.return_value = {}
    assert vector.text_exists("id-2") is False

    vector.delete()
    vector._client.delete_collection.assert_called_once_with("collection_1")


def test_search_by_vector_handles_empty_results(chroma_module):
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    vector._client.collection.query.return_value = {"ids": [], "documents": [], "metadatas": [], "distances": []}

    assert vector.search_by_vector([0.1, 0.2], top_k=2) == []


def test_search_by_vector_applies_score_threshold_and_sorting(chroma_module):
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
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


def test_search_by_full_text_returns_empty_list(chroma_module):
    vector = chroma_module.ChromaVector(
        collection_name="collection_1",
        config=chroma_module.ChromaConfig(host="localhost", port=8000, tenant="t", database="d"),
    )
    assert vector.search_by_full_text("query") == []


def test_factory_init_vector_uses_existing_or_generated_collection(chroma_module, monkeypatch):
    factory = chroma_module.ChromaVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1", index_struct_dict={"vector_store": {"class_prefix": "EXISTING"}}, index_struct=None
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(chroma_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_HOST", "localhost")
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_PORT", 8000)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_TENANT", None)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_DATABASE", None)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_AUTH_PROVIDER", None)
    monkeypatch.setattr(chroma_module.dify_config, "CHROMA_AUTH_CREDENTIALS", None)

    with patch.object(chroma_module, "ChromaVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None
