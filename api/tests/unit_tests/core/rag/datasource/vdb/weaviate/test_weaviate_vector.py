import datetime
import importlib
import sys
import types
import uuid
from collections import UserString
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_weaviate_modules():
    weaviate = types.ModuleType("weaviate")
    weaviate_classes = types.ModuleType("weaviate.classes")
    weaviate_classes.__path__ = []
    weaviate_config = types.ModuleType("weaviate.classes.config")
    weaviate_data = types.ModuleType("weaviate.classes.data")
    weaviate_init = types.ModuleType("weaviate.classes.init")
    weaviate_query = types.ModuleType("weaviate.classes.query")
    weaviate_exceptions = types.ModuleType("weaviate.exceptions")

    class Tokenization(UserString):
        WORD = "word"

    class DataType:
        TEXT = "text"
        INT = "int"

    class Property:
        def __init__(self, name, data_type, tokenization=None):
            self.name = name
            self.data_type = data_type
            self.tokenization = tokenization

    class _Vectors:
        @staticmethod
        def self_provided():
            return "self-provided"

    class Configure:
        Vectors = _Vectors

    class DataObject:
        def __init__(self, uuid, properties, vector=None):
            self.uuid = uuid
            self.properties = properties
            self.vector = vector

    class Auth:
        @staticmethod
        def api_key(value):
            return f"api_key:{value}"

    class _FilterBuilder:
        def __init__(self, field):
            self.field = field

        def equal(self, value):
            return ("equal", self.field, value)

        def contains_any(self, values):
            return ("contains_any", self.field, tuple(values))

    class Filter:
        @staticmethod
        def by_property(field):
            return _FilterBuilder(field)

    class MetadataQuery:
        def __init__(self, distance=False):
            self.distance = distance

    class UnexpectedStatusCodeError(Exception):
        def __init__(self, status_code):
            super().__init__(f"status={status_code}")
            self.status_code = status_code

    class _BatchCtx:
        def __init__(self, batch_manager):
            self.batch_manager = batch_manager

        def __enter__(self):
            return self.batch_manager

        def __exit__(self, exc_type, exc, tb):
            return False

    class _Collection:
        def __init__(self):
            self._batch_manager = SimpleNamespace(add_object=MagicMock())
            self.config = SimpleNamespace(
                get=MagicMock(return_value=SimpleNamespace(properties=[])),
                add_property=MagicMock(),
            )
            self.batch = SimpleNamespace(dynamic=MagicMock(return_value=_BatchCtx(self._batch_manager)))
            self.data = SimpleNamespace(delete_many=MagicMock(), delete_by_id=MagicMock())
            self.query = SimpleNamespace(
                fetch_objects=MagicMock(return_value=SimpleNamespace(objects=[])),
                near_vector=MagicMock(return_value=SimpleNamespace(objects=[])),
                bm25=MagicMock(return_value=SimpleNamespace(objects=[])),
            )

    class _Collections:
        def __init__(self):
            self._collection = _Collection()
            self.exists = MagicMock(return_value=True)
            self.create = MagicMock()
            self.use = MagicMock(return_value=self._collection)
            self.delete = MagicMock()

    class WeaviateClient:
        def __init__(self, ready=True):
            self._ready = ready
            self.collections = _Collections()
            self.close = MagicMock()

        def is_ready(self):
            return self._ready

    default_client = WeaviateClient()

    def connect_to_custom(**_kwargs):
        return default_client

    weaviate.WeaviateClient = WeaviateClient
    weaviate.connect_to_custom = MagicMock(side_effect=connect_to_custom)

    weaviate_config.Tokenization = Tokenization
    weaviate_config.DataType = DataType
    weaviate_config.Property = Property
    weaviate_config.Configure = Configure

    weaviate_data.DataObject = DataObject
    weaviate_init.Auth = Auth
    weaviate_query.Filter = Filter
    weaviate_query.MetadataQuery = MetadataQuery
    weaviate_exceptions.UnexpectedStatusCodeError = UnexpectedStatusCodeError

    return {
        "weaviate": weaviate,
        "weaviate.classes": weaviate_classes,
        "weaviate.classes.config": weaviate_config,
        "weaviate.classes.data": weaviate_data,
        "weaviate.classes.init": weaviate_init,
        "weaviate.classes.query": weaviate_query,
        "weaviate.exceptions": weaviate_exceptions,
    }


@pytest.fixture
def weaviate_module(monkeypatch):
    for name, module in _build_fake_weaviate_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.weaviate.weaviate_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "endpoint": "https://weaviate.example:8443",
        "grpc_endpoint": "grpcs://grpc.example:4444",
        "api_key": "api-key",
        "batch_size": 100,
    }
    values.update(overrides)
    return module.WeaviateConfig.model_validate(values)


def _make_client(module, ready=True):
    return module.weaviate.WeaviateClient(ready=ready)


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("", "config WEAVIATE_ENDPOINT is required"),
    ],
)
def test_weaviate_config_validation(weaviate_module, value, message):
    values = _config(weaviate_module).model_dump()
    values["endpoint"] = value

    with pytest.raises(ValidationError, match=message):
        weaviate_module.WeaviateConfig.model_validate(values)


def test_init_and_del_handle_client_lifecycle(weaviate_module):
    with patch.object(weaviate_module.WeaviateVector, "_init_client", return_value=MagicMock()) as init_client:
        vector = weaviate_module.WeaviateVector("collection_1", _config(weaviate_module), attributes=["doc_id"])

    init_client.assert_called_once()
    assert vector._attributes == ["doc_id"]

    vector.__del__()
    vector._client.close.assert_called_once()

    vector._client.close.side_effect = RuntimeError("close failed")
    vector.__del__()

    empty = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    empty.__del__()


def test_init_client_parses_http_grpc_and_auth(weaviate_module):
    client = _make_client(weaviate_module, ready=True)
    weaviate_module.weaviate.connect_to_custom = MagicMock(return_value=client)

    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    result = vector._init_client(_config(weaviate_module))

    assert result is client
    kwargs = weaviate_module.weaviate.connect_to_custom.call_args.kwargs
    assert kwargs["http_host"] == "weaviate.example"
    assert kwargs["http_port"] == 8443
    assert kwargs["http_secure"] is True
    assert kwargs["grpc_host"] == "grpc.example"
    assert kwargs["grpc_port"] == 4444
    assert kwargs["grpc_secure"] is True
    assert kwargs["auth_credentials"] == "api_key:api-key"

    weaviate_module.weaviate.connect_to_custom.reset_mock()
    vector._init_client(_config(weaviate_module, grpc_endpoint="grpc.internal:50051", endpoint="http://host:8080"))
    kwargs = weaviate_module.weaviate.connect_to_custom.call_args.kwargs
    assert kwargs["http_secure"] is False
    assert kwargs["grpc_host"] == "grpc.internal"
    assert kwargs["grpc_port"] == 50051
    assert kwargs["grpc_secure"] is False

    weaviate_module.weaviate.connect_to_custom.reset_mock()
    vector._init_client(_config(weaviate_module, grpc_endpoint=None, endpoint="http://no-grpc.example"))
    kwargs = weaviate_module.weaviate.connect_to_custom.call_args.kwargs
    assert kwargs["grpc_host"] == "no-grpc.example"
    assert kwargs["grpc_port"] == 50051

    not_ready_client = _make_client(weaviate_module, ready=False)
    weaviate_module.weaviate.connect_to_custom = MagicMock(return_value=not_ready_client)
    with pytest.raises(ConnectionError, match="not ready"):
        vector._init_client(_config(weaviate_module))


def test_collection_name_and_index_struct_helpers(weaviate_module, monkeypatch):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"

    dataset = SimpleNamespace(index_struct_dict={"vector_store": {"class_prefix": "MyCollection"}}, id="dataset-1")
    assert vector.get_collection_name(dataset) == "MyCollection_Node"

    dataset = SimpleNamespace(index_struct_dict={"vector_store": {"class_prefix": "MyCollection_Node"}}, id="dataset-1")
    assert vector.get_collection_name(dataset) == "MyCollection_Node"

    monkeypatch.setattr(weaviate_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    dataset = SimpleNamespace(index_struct_dict=None, id="dataset-2")
    assert vector.get_collection_name(dataset) == "AUTO_COLLECTION"

    assert vector.get_type() == weaviate_module.VectorType.WEAVIATE
    assert vector.to_index_struct() == {
        "type": weaviate_module.VectorType.WEAVIATE,
        "vector_store": {"class_prefix": "collection_1"},
    }


def test_create_collection_uses_cache_and_handles_errors(weaviate_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(weaviate_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(weaviate_module.redis_client, "set", MagicMock())

    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"
    vector._client = _make_client(weaviate_module)
    vector._ensure_properties = MagicMock()

    monkeypatch.setattr(weaviate_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection()
    vector._client.collections.create.assert_not_called()

    monkeypatch.setattr(weaviate_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.collections.exists.return_value = False
    monkeypatch.setattr(weaviate_module.dify_config, "WEAVIATE_TOKENIZATION", "field")
    vector._create_collection()

    vector._client.collections.create.assert_called_once()
    vector._ensure_properties.assert_called_once()
    weaviate_module.redis_client.set.assert_called_once()

    vector._client.collections.exists.side_effect = RuntimeError("boom")
    with pytest.raises(RuntimeError, match="boom"):
        vector._create_collection()


def test_ensure_properties_adds_missing_fields(weaviate_module):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"
    vector._client = _make_client(weaviate_module)

    vector._client.collections.exists.return_value = False
    vector._ensure_properties()
    vector._client.collections.use.assert_not_called()

    vector._client.collections.exists.return_value = True
    col = vector._client.collections.use.return_value
    col.config.get.return_value = SimpleNamespace(properties=[SimpleNamespace(name="document_id")])
    col.config.add_property.side_effect = [None, RuntimeError("add failed")]

    vector._ensure_properties()

    assert col.config.add_property.call_count == 2


def test_uuid_helpers_json_serializable_and_create_delegate(weaviate_module):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)

    docs = [Document(page_content="same", metadata={}), Document(page_content="same", metadata={})]
    uuids = vector._get_uuids(docs)
    assert uuids[0] == uuids[1]
    assert vector._is_uuid(uuids[0]) is True
    assert vector._is_uuid("not-a-uuid") is False

    now = datetime.datetime(2026, 1, 1, 0, 0, 0)
    assert vector._json_serializable(now) == "2026-01-01T00:00:00"
    assert vector._json_serializable("plain") == "plain"

    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="a", metadata={"doc_id": "id-1"})]
    vector.create(docs, [[0.1]])
    vector._create_collection.assert_called_once()
    vector.add_texts.assert_called_once_with(docs, [[0.1]])


def test_add_texts_handles_uuid_fallback_and_batch_insert(weaviate_module, monkeypatch):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"
    vector._client = _make_client(weaviate_module)

    valid_uuid = "550e8400-e29b-41d4-a716-446655440000"
    vector._get_uuids = MagicMock(return_value=["invalid", valid_uuid])
    monkeypatch.setattr(weaviate_module._uuid, "uuid4", lambda: uuid.UUID("12345678-1234-5678-1234-567812345678"))

    docs = [
        Document(page_content="doc-1", metadata={"doc_id": "1", "created_at": datetime.datetime(2026, 1, 1)}),
        Document(page_content="doc-2", metadata={"doc_id": "2"}),
    ]
    ids = vector.add_texts(docs, [[0.1, 0.2], []])

    assert ids == ["12345678-1234-5678-1234-567812345678", valid_uuid]
    add_calls = vector._client.collections.use.return_value._batch_manager.add_object.call_args_list
    assert len(add_calls) == 2
    first_kwargs = add_calls[0].kwargs
    second_kwargs = add_calls[1].kwargs
    assert first_kwargs["vector"] == {"default": [0.1, 0.2]}
    assert second_kwargs["vector"] is None
    assert first_kwargs["properties"]["created_at"] == "2026-01-01T00:00:00"


def test_delete_and_text_exists_operations(weaviate_module):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"
    vector._client = _make_client(weaviate_module)

    vector._client.collections.exists.return_value = False
    vector.delete_by_metadata_field("doc_id", "id-1")
    vector._client.collections.use.assert_not_called()

    assert vector.text_exists("id-1") is False

    vector._client.collections.exists.return_value = True
    col = vector._client.collections.use.return_value
    vector.delete_by_metadata_field("doc_id", "id-1")
    col.data.delete_many.assert_called_once()
    where = col.data.delete_many.call_args.kwargs["where"]
    assert where == ("equal", "doc_id", "id-1")

    col.query.fetch_objects.return_value = SimpleNamespace(objects=[SimpleNamespace()])
    assert vector.text_exists("id-1") is True

    vector.delete()
    vector._client.collections.delete.assert_called_once_with("collection_1")

    vector._client.collections.delete.reset_mock()
    vector._client.collections.exists.return_value = False
    vector.delete()
    vector._client.collections.delete.assert_not_called()


def test_delete_by_ids_handles_404_and_raises_others(weaviate_module):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"
    vector._client = _make_client(weaviate_module)

    vector._client.collections.exists.return_value = False
    vector.delete_by_ids(["id-1"])
    vector._client.collections.use.assert_not_called()

    vector._client.collections.exists.return_value = True
    col = vector._client.collections.use.return_value
    error_cls = weaviate_module.UnexpectedStatusCodeError

    col.data.delete_by_id.side_effect = [error_cls(404), None]
    vector.delete_by_ids(["id-1", "id-2"])

    col.data.delete_by_id.side_effect = error_cls(500)
    with pytest.raises(error_cls):
        vector.delete_by_ids(["id-3"])


def test_search_by_vector_applies_filters_and_threshold(weaviate_module):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"
    vector._attributes = ["doc_id"]
    vector._client = _make_client(weaviate_module)

    vector._client.collections.exists.return_value = False
    assert vector.search_by_vector([0.1]) == []

    vector._client.collections.exists.return_value = True
    col = vector._client.collections.use.return_value
    col.query.near_vector.return_value = SimpleNamespace(
        objects=[
            SimpleNamespace(
                properties={"text": "high", "doc_id": "1", "document_id": "d-1"},
                metadata=SimpleNamespace(distance=0.1),
            ),
            SimpleNamespace(
                properties={"text": "low", "doc_id": "2", "document_id": "d-2"},
                metadata=SimpleNamespace(distance=0.6),
            ),
            SimpleNamespace(
                properties={"text": "none-distance", "doc_id": "3", "document_id": "d-3"},
                metadata=SimpleNamespace(distance=None),
            ),
        ]
    )

    docs = vector.search_by_vector([0.1, 0.2], top_k=3, score_threshold=0.3, document_ids_filter=["d-1", "d-2"])

    assert [doc.page_content for doc in docs] == ["high", "low"]
    assert docs[0].metadata["score"] == pytest.approx(0.9)
    assert docs[1].metadata["score"] == pytest.approx(0.4)
    kwargs = col.query.near_vector.call_args.kwargs
    assert kwargs["filters"] == ("contains_any", "document_id", ("d-1", "d-2"))
    assert kwargs["target_vector"] == "default"


def test_search_by_full_text_parses_vectors(weaviate_module):
    vector = weaviate_module.WeaviateVector.__new__(weaviate_module.WeaviateVector)
    vector._collection_name = "collection_1"
    vector._attributes = ["doc_id"]
    vector._client = _make_client(weaviate_module)

    vector._client.collections.exists.return_value = False
    assert vector.search_by_full_text("hello") == []

    vector._client.collections.exists.return_value = True
    col = vector._client.collections.use.return_value
    col.query.bm25.return_value = SimpleNamespace(
        objects=[
            SimpleNamespace(properties={"text": "doc-1", "doc_id": "1"}, vector={"default": [0.1]}),
            SimpleNamespace(properties={"text": "doc-2", "doc_id": "2"}, vector={"other": [0.2]}),
            SimpleNamespace(properties={"text": "doc-3", "doc_id": "3"}, vector=[0.3]),
        ]
    )

    docs = vector.search_by_full_text("hello", top_k=2, document_ids_filter=["d-1"])

    assert [doc.vector for doc in docs] == [[0.1], [0.2], [0.3]]
    assert docs[0].page_content == "doc-1"
    kwargs = col.query.bm25.call_args.kwargs
    assert kwargs["filters"] == ("contains_any", "document_id", ("d-1",))


def test_weaviate_factory_uses_existing_or_generated_collection(weaviate_module, monkeypatch):
    factory = weaviate_module.WeaviateVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(weaviate_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(weaviate_module.dify_config, "WEAVIATE_ENDPOINT", "https://weaviate.example")
    monkeypatch.setattr(weaviate_module.dify_config, "WEAVIATE_GRPC_ENDPOINT", "grpc.example:50051")
    monkeypatch.setattr(weaviate_module.dify_config, "WEAVIATE_API_KEY", "api-key")
    monkeypatch.setattr(weaviate_module.dify_config, "WEAVIATE_BATCH_SIZE", 100)

    with patch.object(weaviate_module, "WeaviateVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=["doc_id"], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=["doc_id"], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
