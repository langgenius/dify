import importlib
import os
import sys
import types
from collections import UserDict
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_qdrant_modules():
    qdrant_client = types.ModuleType("qdrant_client")
    qdrant_http = types.ModuleType("qdrant_client.http")
    qdrant_http_models = types.ModuleType("qdrant_client.http.models")
    qdrant_http_exceptions = types.ModuleType("qdrant_client.http.exceptions")
    qdrant_local_pkg = types.ModuleType("qdrant_client.local")
    qdrant_local_mod = types.ModuleType("qdrant_client.local.qdrant_local")

    class UnexpectedResponseError(Exception):
        def __init__(self, status_code):
            super().__init__(f"status={status_code}")
            self.status_code = status_code

    class FilterSelector:
        def __init__(self, filter):
            self.filter = filter

    class HnswConfigDiff:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class TextIndexParams:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class VectorParams:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class PointStruct:
        def __init__(self, **kwargs):
            self.id = kwargs["id"]
            self.vector = kwargs["vector"]
            self.payload = kwargs["payload"]

    class Filter:
        def __init__(self, must=None):
            self.must = must or []

    class FieldCondition:
        def __init__(self, key, match):
            self.key = key
            self.match = match

    class MatchValue:
        def __init__(self, value):
            self.value = value

    class MatchAny:
        def __init__(self, any):
            self.any = any

    class MatchText:
        def __init__(self, text):
            self.text = text

    class _Distance(UserDict):
        def __getitem__(self, key):
            return key

    class QdrantClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.get_collections = MagicMock(return_value=SimpleNamespace(collections=[]))
            self.create_collection = MagicMock()
            self.create_payload_index = MagicMock()
            self.upsert = MagicMock()
            self.delete = MagicMock()
            self.delete_collection = MagicMock()
            self.retrieve = MagicMock(return_value=[])
            self.search = MagicMock(return_value=[])
            self.scroll = MagicMock(return_value=([], None))

    class QdrantLocal(QdrantClient):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self._load = MagicMock()

    qdrant_client.QdrantClient = QdrantClient
    qdrant_http_models.FilterSelector = FilterSelector
    qdrant_http_models.HnswConfigDiff = HnswConfigDiff
    qdrant_http_models.PayloadSchemaType = SimpleNamespace(KEYWORD="KEYWORD")
    qdrant_http_models.TextIndexParams = TextIndexParams
    qdrant_http_models.TextIndexType = SimpleNamespace(TEXT="TEXT")
    qdrant_http_models.TokenizerType = SimpleNamespace(MULTILINGUAL="MULTILINGUAL")
    qdrant_http_models.VectorParams = VectorParams
    qdrant_http_models.Distance = _Distance()
    qdrant_http_models.PointStruct = PointStruct
    qdrant_http_models.Filter = Filter
    qdrant_http_models.FieldCondition = FieldCondition
    qdrant_http_models.MatchValue = MatchValue
    qdrant_http_models.MatchAny = MatchAny
    qdrant_http_models.MatchText = MatchText
    qdrant_http_exceptions.UnexpectedResponse = UnexpectedResponseError

    qdrant_http.models = qdrant_http_models
    qdrant_local_mod.QdrantLocal = QdrantLocal
    qdrant_local_pkg.qdrant_local = qdrant_local_mod

    return {
        "qdrant_client": qdrant_client,
        "qdrant_client.http": qdrant_http,
        "qdrant_client.http.models": qdrant_http_models,
        "qdrant_client.http.exceptions": qdrant_http_exceptions,
        "qdrant_client.local": qdrant_local_pkg,
        "qdrant_client.local.qdrant_local": qdrant_local_mod,
    }


@pytest.fixture
def qdrant_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_qdrant_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_qdrant.qdrant_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "endpoint": "http://localhost:6333",
        "api_key": "api-key",
        "timeout": 20,
        "root_path": "/tmp",
        "grpc_port": 6334,
        "prefer_grpc": False,
        "replication_factor": 1,
        "write_consistency_factor": 1,
    }
    values.update(overrides)
    return module.QdrantConfig.model_validate(values)


def test_qdrant_config_to_params(qdrant_module):
    url_params = _config(qdrant_module).to_qdrant_params().model_dump()
    assert url_params["url"] == "http://localhost:6333"
    assert url_params["verify"] is False

    path_config = _config(qdrant_module, endpoint="path:storage")
    assert path_config.to_qdrant_params().path == os.path.join("/tmp", "storage")

    with pytest.raises(ValueError, match="Root path is not set"):
        _config(qdrant_module, endpoint="path:storage", root_path=None).to_qdrant_params()


def test_init_and_basic_behaviour(qdrant_module):
    vector = qdrant_module.QdrantVector("collection_1", "group-1", _config(qdrant_module))
    assert vector.get_type() == qdrant_module.VectorType.QDRANT
    assert vector.to_index_struct()["vector_store"]["class_prefix"] == "collection_1"

    docs = [Document(page_content="a", metadata={"doc_id": "a"})]
    vector.create_collection = MagicMock()
    vector.add_texts = MagicMock()
    vector.create(docs, [[0.1]])
    vector.create_collection.assert_called_once_with("collection_1", 1)
    vector.add_texts.assert_called_once()


def test_create_collection_and_add_texts(qdrant_module, monkeypatch: pytest.MonkeyPatch):
    vector = qdrant_module.QdrantVector("collection_1", "group-1", _config(qdrant_module))
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(qdrant_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(qdrant_module.redis_client, "set", MagicMock())

    monkeypatch.setattr(qdrant_module.redis_client, "get", MagicMock(return_value=1))
    vector.create_collection("collection_1", 3)
    vector._client.create_collection.assert_not_called()

    monkeypatch.setattr(qdrant_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.get_collections.return_value = SimpleNamespace(collections=[])
    vector.create_collection("collection_1", 3)
    vector._client.create_collection.assert_called_once()
    assert vector._client.create_payload_index.call_count == 4
    qdrant_module.redis_client.set.assert_called_once()

    # add_texts and generated batches
    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
    ]
    ids = vector.add_texts(docs, [[0.1], [0.2]])
    assert ids == ["id-1", "id-2"]
    assert vector._client.upsert.call_count == 1

    payloads = qdrant_module.QdrantVector._build_payloads(
        ["a"], [{"doc_id": "id-1"}], "content", "metadata", "g1", "group_id"
    )
    assert payloads[0]["group_id"] == "g1"
    with pytest.raises(ValueError, match="At least one of the texts is None"):
        qdrant_module.QdrantVector._build_payloads(
            [None], [{"doc_id": "id-1"}], "content", "metadata", "g1", "group_id"
        )


def test_delete_and_exists_paths(qdrant_module):
    vector = qdrant_module.QdrantVector("collection_1", "group-1", _config(qdrant_module))
    unexpected = sys.modules["qdrant_client.http.exceptions"].UnexpectedResponse

    vector._client.delete.side_effect = unexpected(404)
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.delete.side_effect = None

    vector._client.delete.side_effect = unexpected(500)
    with pytest.raises(unexpected):
        vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.delete.side_effect = None

    vector._client.delete.side_effect = unexpected(404)
    vector.delete()
    vector._client.delete.side_effect = unexpected(500)
    with pytest.raises(unexpected):
        vector.delete()
    vector._client.delete.side_effect = None

    vector._client.delete.side_effect = unexpected(404)
    vector.delete_by_ids(["doc-1"])
    vector._client.delete.side_effect = unexpected(500)
    with pytest.raises(unexpected):
        vector.delete_by_ids(["doc-1"])
    vector._client.delete.side_effect = None

    vector._client.get_collections.return_value = SimpleNamespace(collections=[SimpleNamespace(name="other")])
    assert vector.text_exists("id-1") is False
    vector._client.get_collections.return_value = SimpleNamespace(collections=[SimpleNamespace(name="collection_1")])
    vector._client.retrieve.return_value = [{"id": "id-1"}]
    assert vector.text_exists("id-1") is True


def test_search_and_helper_methods(qdrant_module):
    vector = qdrant_module.QdrantVector("collection_1", "group-1", _config(qdrant_module))
    assert vector.search_by_vector([0.1], score_threshold=1.0) == []

    vector._client.search.return_value = [
        SimpleNamespace(payload=None, score=0.9, vector=[0.1]),
        SimpleNamespace(payload={"metadata": {"doc_id": "1"}, "page_content": "doc-a"}, score=0.8, vector=[0.1]),
    ]
    docs = vector.search_by_vector([0.1], top_k=2, score_threshold=0.5, document_ids_filter=["d-1"])
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.8)

    # full text search: keyword split, dedup and top_k limit
    scroll_results = [
        (
            [
                SimpleNamespace(id="p1", payload={"page_content": "doc-1", "metadata": {"doc_id": "1"}}, vector=[0.1]),
                SimpleNamespace(id="p2", payload={"page_content": "doc-2", "metadata": {"doc_id": "2"}}, vector=[0.2]),
            ],
            None,
        ),
        (
            [
                SimpleNamespace(id="p2", payload={"page_content": "doc-2", "metadata": {"doc_id": "2"}}, vector=[0.2]),
            ],
            None,
        ),
    ]
    vector._client.scroll.side_effect = scroll_results
    docs = vector.search_by_full_text("hello world", top_k=2, document_ids_filter=["d-1"])
    assert len(docs) == 2
    assert vector.search_by_full_text("   ", top_k=2) == []

    local_client = qdrant_module.QdrantLocal()
    vector._client = local_client
    vector._reload_if_needed()
    local_client._load.assert_called_once()

    doc = vector._document_from_scored_point(
        SimpleNamespace(payload={"page_content": "doc", "metadata": {"doc_id": "1"}}, vector=[0.1]),
        "page_content",
        "metadata",
    )
    assert doc.page_content == "doc"


def test_qdrant_factory_paths(qdrant_module, monkeypatch: pytest.MonkeyPatch):
    factory = qdrant_module.QdrantVectorFactory()
    dataset = SimpleNamespace(
        id="dataset-1",
        tenant_id="tenant-1",
        collection_binding_id=None,
        index_struct_dict=None,
        index_struct=None,
    )
    monkeypatch.setattr(qdrant_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(qdrant_module, "current_app", SimpleNamespace(config=SimpleNamespace(root_path="/root")))
    monkeypatch.setattr(qdrant_module.dify_config, "QDRANT_URL", "http://localhost:6333")
    monkeypatch.setattr(qdrant_module.dify_config, "QDRANT_API_KEY", "api-key")
    monkeypatch.setattr(qdrant_module.dify_config, "QDRANT_CLIENT_TIMEOUT", 20)
    monkeypatch.setattr(qdrant_module.dify_config, "QDRANT_GRPC_PORT", 6334)
    monkeypatch.setattr(qdrant_module.dify_config, "QDRANT_GRPC_ENABLED", False)
    monkeypatch.setattr(qdrant_module.dify_config, "QDRANT_REPLICATION_FACTOR", 1)

    with patch.object(qdrant_module, "QdrantVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())
    assert result == "vector"
    assert vector_cls.call_args.kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset.index_struct is not None

    # collection binding lookup path
    dataset.collection_binding_id = "binding-1"
    dataset.index_struct_dict = {"vector_store": {"class_prefix": "existing"}}
    monkeypatch.setattr(qdrant_module, "select", lambda _model: SimpleNamespace(where=lambda *_args: "stmt"))
    qdrant_module.db.session.scalars = MagicMock(
        return_value=SimpleNamespace(one_or_none=lambda: SimpleNamespace(collection_name="BOUND_COLLECTION"))
    )
    with patch.object(qdrant_module, "QdrantVector", return_value="vector") as vector_cls:
        factory.init_vector(dataset, attributes=[], embeddings=MagicMock())
    assert vector_cls.call_args.kwargs["collection_name"] == "BOUND_COLLECTION"

    qdrant_module.db.session.scalars = MagicMock(return_value=SimpleNamespace(one_or_none=lambda: None))
    with pytest.raises(ValueError, match="Dataset Collection Bindings does not exist"):
        factory.init_vector(dataset, attributes=[], embeddings=MagicMock())
