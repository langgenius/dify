import importlib
import json
import sys
import types
from collections import UserDict
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_vikingdb_modules():
    volcengine = types.ModuleType("volcengine")
    volcengine.__path__ = []
    viking_db = types.ModuleType("volcengine.viking_db")

    class Data(UserDict):
        def __init__(self, payload):
            super().__init__(payload)
            self.fields = payload

    class DistanceType:
        L2 = "L2"

    class IndexType:
        HNSW = "HNSW"

    class QuantType:
        Float = "Float"

    class FieldType:
        String = "string"
        Text = "text"
        Vector = "vector"

    class Field:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class VectorIndexParams:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _Collection:
        def __init__(self):
            self.upsert_data = MagicMock()
            self.fetch_data = MagicMock(return_value=None)
            self.delete_data = MagicMock()

    class _Index:
        def __init__(self):
            self.search = MagicMock(return_value=[])
            self.search_by_vector = MagicMock(return_value=[])

    class VikingDBService:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.create_collection = MagicMock()
            self.create_index = MagicMock()
            self.drop_index = MagicMock()
            self.drop_collection = MagicMock()
            self._collection = _Collection()
            self._index = _Index()
            self.get_collection = MagicMock(return_value=self._collection)
            self.get_index = MagicMock(return_value=self._index)

    viking_db.Data = Data
    viking_db.DistanceType = DistanceType
    viking_db.Field = Field
    viking_db.FieldType = FieldType
    viking_db.IndexType = IndexType
    viking_db.QuantType = QuantType
    viking_db.VectorIndexParams = VectorIndexParams
    viking_db.VikingDBService = VikingDBService

    return {"volcengine": volcengine, "volcengine.viking_db": viking_db}


@pytest.fixture
def vikingdb_module(monkeypatch):
    for name, module in _build_fake_vikingdb_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.vikingdb.vikingdb_vector as module

    return importlib.reload(module)


def _config(module):
    return module.VikingDBConfig(
        access_key="ak",
        secret_key="sk",
        host="host",
        region="region",
        scheme="https",
        connection_timeout=10,
        socket_timeout=20,
    )


def test_init_get_type_and_has_checks(vikingdb_module):
    vector = vikingdb_module.VikingDBVector("collection_1", "group-1", _config(vikingdb_module))

    assert vector.get_type() == vikingdb_module.VectorType.VIKINGDB
    assert vector._index_name == "collection_1_idx"

    assert vector._has_collection() is True
    assert vector._has_index() is True

    vector._client.get_collection.side_effect = RuntimeError("missing")
    assert vector._has_collection() is False
    vector._client.get_collection.side_effect = None

    vector._client.get_index.side_effect = RuntimeError("missing")
    assert vector._has_index() is False


def test_create_collection_cache_and_creation_paths(vikingdb_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(vikingdb_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(vikingdb_module.redis_client, "set", MagicMock())

    vector = vikingdb_module.VikingDBVector("collection_1", "group-1", _config(vikingdb_module))

    monkeypatch.setattr(vikingdb_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(3)
    vector._client.create_collection.assert_not_called()
    vector._client.create_index.assert_not_called()

    monkeypatch.setattr(vikingdb_module.redis_client, "get", MagicMock(return_value=None))
    vector._has_collection = MagicMock(return_value=False)
    vector._has_index = MagicMock(return_value=False)
    vector._create_collection(4)

    vector._client.create_collection.assert_called_once()
    vector._client.create_index.assert_called_once()
    vikingdb_module.redis_client.set.assert_called_once()


def test_create_and_add_texts(vikingdb_module):
    vector = vikingdb_module.VikingDBVector("collection_1", "group-1", _config(vikingdb_module))
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock()

    docs = [Document(page_content="hello", metadata={"doc_id": "id-1"})]
    vector.create(docs, [[0.1, 0.2]])

    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])

    vector = vikingdb_module.VikingDBVector("collection_2", "group-2", _config(vikingdb_module))
    docs = [
        Document(page_content="a", metadata={"doc_id": "id-a", "document_id": "d-1"}),
        Document(page_content="b", metadata={"doc_id": "id-b", "document_id": "d-2"}),
    ]
    vector.add_texts(docs, [[0.1], [0.2]])

    vector._client.get_collection.assert_called()
    upsert_docs = vector._client.get_collection.return_value.upsert_data.call_args.args[0]
    assert upsert_docs[0][vikingdb_module.vdb_Field.PRIMARY_KEY] == "id-a"
    assert upsert_docs[0][vikingdb_module.vdb_Field.GROUP_KEY] == "group-2"


def test_text_exists_and_delete_operations(vikingdb_module):
    vector = vikingdb_module.VikingDBVector("collection_1", "group-1", _config(vikingdb_module))

    vector._client.get_collection.return_value.fetch_data.return_value = SimpleNamespace(fields={"message": "ok"})
    assert vector.text_exists("id-1") is True

    vector._client.get_collection.return_value.fetch_data.return_value = SimpleNamespace(
        fields={"message": "data does not exist"}
    )
    assert vector.text_exists("id-1") is False

    vector._client.get_collection.return_value.fetch_data.return_value = None
    assert vector.text_exists("id-1") is False

    vector.delete_by_ids(["id-1"])
    vector._client.get_collection.return_value.delete_data.assert_called_once_with(["id-1"])

    vector.get_ids_by_metadata_field = MagicMock(return_value=["id-2"])
    vector.delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("doc_id", "doc-1")
    vector.delete_by_ids.assert_called_once_with(["id-2"])


def test_get_ids_and_search_helpers(vikingdb_module):
    vector = vikingdb_module.VikingDBVector("collection_1", "group-1", _config(vikingdb_module))

    vector._client.get_index.return_value.search.return_value = []
    assert vector.get_ids_by_metadata_field("doc_id", "x") == []

    vector._client.get_index.return_value.search.return_value = [
        SimpleNamespace(id="a", fields={vikingdb_module.vdb_Field.METADATA_KEY: json.dumps({"doc_id": "x"})}),
        SimpleNamespace(id="b", fields={vikingdb_module.vdb_Field.METADATA_KEY: json.dumps({"doc_id": "y"})}),
        SimpleNamespace(id="c", fields={}),
    ]
    assert vector.get_ids_by_metadata_field("doc_id", "x") == ["a"]

    empty_docs = vector._get_search_res([], score_threshold=0.1)
    assert empty_docs == []

    results = [
        SimpleNamespace(
            id="a",
            score=0.3,
            fields={
                vikingdb_module.vdb_Field.CONTENT_KEY: "doc-a",
                vikingdb_module.vdb_Field.METADATA_KEY: json.dumps({"document_id": "d-1"}),
            },
        ),
        SimpleNamespace(
            id="b",
            score=0.9,
            fields={
                vikingdb_module.vdb_Field.CONTENT_KEY: "doc-b",
                vikingdb_module.vdb_Field.METADATA_KEY: json.dumps({"document_id": "d-2"}),
            },
        ),
    ]

    docs = vector._get_search_res(results, score_threshold=0.2)
    assert [doc.page_content for doc in docs] == ["doc-b", "doc-a"]

    vector._client.get_index.return_value.search_by_vector.return_value = results
    filtered_docs = vector.search_by_vector([0.1], top_k=2, score_threshold=0.2, document_ids_filter=["d-2"])
    assert len(filtered_docs) == 1
    assert filtered_docs[0].page_content == "doc-b"
    assert vector.search_by_full_text("query") == []


def test_delete_drops_index_and_collection_when_present(vikingdb_module):
    vector = vikingdb_module.VikingDBVector("collection_1", "group-1", _config(vikingdb_module))
    vector._has_index = MagicMock(return_value=True)
    vector._has_collection = MagicMock(return_value=True)

    vector.delete()

    vector._client.drop_index.assert_called_once_with("collection_1", "collection_1_idx")
    vector._client.drop_collection.assert_called_once_with("collection_1")

    vector._client.drop_index.reset_mock()
    vector._client.drop_collection.reset_mock()
    vector._has_index.return_value = False
    vector._has_collection.return_value = False
    vector.delete()

    vector._client.drop_index.assert_not_called()
    vector._client.drop_collection.assert_not_called()


def test_vikingdb_factory_validates_config_and_builds_vector(vikingdb_module, monkeypatch):
    factory = vikingdb_module.VikingDBVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(vikingdb_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")

    with patch.object(vikingdb_module, "VikingDBVector", return_value="vector") as vector_cls:
        monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_ACCESS_KEY", "ak")
        monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_SECRET_KEY", "sk")
        monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_HOST", "host")
        monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_REGION", "region")
        monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_SCHEME", "https")
        monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_CONNECTION_TIMEOUT", 10)
        monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_SOCKET_TIMEOUT", 20)

        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None


@pytest.mark.parametrize(
    ("field", "message"),
    [
        ("VIKINGDB_ACCESS_KEY", "VIKINGDB_ACCESS_KEY should not be None"),
        ("VIKINGDB_SECRET_KEY", "VIKINGDB_SECRET_KEY should not be None"),
        ("VIKINGDB_HOST", "VIKINGDB_HOST should not be None"),
        ("VIKINGDB_REGION", "VIKINGDB_REGION should not be None"),
        ("VIKINGDB_SCHEME", "VIKINGDB_SCHEME should not be None"),
    ],
)
def test_vikingdb_factory_raises_when_required_config_missing(vikingdb_module, monkeypatch, field, message):
    factory = vikingdb_module.VikingDBVectorFactory()
    dataset = SimpleNamespace(
        id="dataset-1", index_struct_dict={"vector_store": {"class_prefix": "existing"}}, index_struct=None
    )

    monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_ACCESS_KEY", "ak")
    monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_SECRET_KEY", "sk")
    monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_HOST", "host")
    monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_REGION", "region")
    monkeypatch.setattr(vikingdb_module.dify_config, "VIKINGDB_SCHEME", "https")
    monkeypatch.setattr(vikingdb_module.dify_config, field, None)

    with pytest.raises(ValueError, match=message):
        factory.init_vector(dataset, attributes=[], embeddings=MagicMock())
