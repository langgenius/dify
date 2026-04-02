import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_pymilvus_modules():
    pymilvus = types.ModuleType("pymilvus")
    pymilvus.__path__ = []
    pymilvus_milvus_client = types.ModuleType("pymilvus.milvus_client")
    pymilvus_orm = types.ModuleType("pymilvus.orm")
    pymilvus_orm.__path__ = []
    pymilvus_orm_types = types.ModuleType("pymilvus.orm.types")

    class MilvusError(Exception):
        pass

    class MilvusClient:
        def __init__(self, **kwargs):
            self.init_kwargs = kwargs
            self.has_collection = MagicMock(return_value=False)
            self.describe_collection = MagicMock(
                return_value={"fields": [{"name": "id"}, {"name": "content"}, {"name": "metadata"}]}
            )
            self.get_server_version = MagicMock(return_value="2.5.0")
            self.insert = MagicMock(return_value=[1])
            self.query = MagicMock(return_value=[])
            self.delete = MagicMock()
            self.drop_collection = MagicMock()
            self.search = MagicMock(return_value=[[]])
            self.create_collection = MagicMock()

    class IndexParams:
        def __init__(self):
            self.indexes = []

        def add_index(self, **kwargs):
            self.indexes.append(kwargs)

    class DataType:
        JSON = "JSON"
        VARCHAR = "VARCHAR"
        INT64 = "INT64"
        SPARSE_FLOAT_VECTOR = "SPARSE_FLOAT_VECTOR"
        FLOAT_VECTOR = "FLOAT_VECTOR"

    class FieldSchema:
        def __init__(self, name, dtype, **kwargs):
            self.name = name
            self.dtype = dtype
            self.kwargs = kwargs

    class CollectionSchema:
        def __init__(self, fields):
            self.fields = fields
            self.functions = []

        def add_function(self, func):
            self.functions.append(func)

    class FunctionType:
        BM25 = "BM25"

    class Function:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    def infer_dtype_bydata(_value):
        return DataType.FLOAT_VECTOR

    pymilvus.MilvusException = MilvusError
    pymilvus.MilvusClient = MilvusClient
    pymilvus.IndexParams = IndexParams
    pymilvus.CollectionSchema = CollectionSchema
    pymilvus.DataType = DataType
    pymilvus.FieldSchema = FieldSchema
    pymilvus.Function = Function
    pymilvus.FunctionType = FunctionType
    pymilvus_milvus_client.IndexParams = IndexParams
    pymilvus_orm.types = pymilvus_orm_types
    pymilvus_orm_types.infer_dtype_bydata = infer_dtype_bydata

    # Attach submodules for dotted imports
    pymilvus.milvus_client = pymilvus_milvus_client
    pymilvus.orm = pymilvus_orm

    return {
        "pymilvus": pymilvus,
        "pymilvus.milvus_client": pymilvus_milvus_client,
        "pymilvus.orm": pymilvus_orm,
        "pymilvus.orm.types": pymilvus_orm_types,
    }


@pytest.fixture
def milvus_module(monkeypatch):
    for name, module in _build_fake_pymilvus_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.milvus.milvus_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "uri": "http://localhost:19530",
        "user": "root",
        "password": "Milvus",
        "database": "default",
        "enable_hybrid_search": False,
        "analyzer_params": None,
    }
    values.update(overrides)
    return module.MilvusConfig.model_validate(values)


def test_config_validation_and_defaults(milvus_module):
    valid_config = {"uri": "http://localhost:19530", "user": "root", "password": "Milvus"}

    for key in valid_config:
        config = valid_config.copy()
        del config[key]
        with pytest.raises(ValidationError) as e:
            milvus_module.MilvusConfig.model_validate(config)
        assert e.value.errors()[0]["msg"] == f"Value error, config MILVUS_{key.upper()} is required"

    config = milvus_module.MilvusConfig.model_validate(valid_config)
    assert config.database == "default"

    token_config = milvus_module.MilvusConfig.model_validate(
        {"uri": "http://localhost:19530", "token": "token-value", "database": "db-1"}
    )
    assert token_config.token == "token-value"


def test_config_to_milvus_params(milvus_module):
    config = _config(milvus_module, analyzer_params='{"tokenizer":"standard"}')

    params = config.to_milvus_params()

    assert params["uri"] == "http://localhost:19530"
    assert params["db_name"] == "default"
    assert params["analyzer_params"] == '{"tokenizer":"standard"}'


def test_init_client_supports_token_and_user_password(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    token_client = vector._init_client(
        milvus_module.MilvusConfig.model_validate({"uri": "http://localhost:19530", "token": "abc", "database": "db"})
    )
    assert token_client.init_kwargs == {"uri": "http://localhost:19530", "token": "abc", "db_name": "db"}

    user_client = vector._init_client(_config(milvus_module))
    assert user_client.init_kwargs["uri"] == "http://localhost:19530"
    assert user_client.init_kwargs["user"] == "root"
    assert user_client.init_kwargs["password"] == "Milvus"


def test_init_loads_fields_when_collection_exists(milvus_module):
    client = milvus_module.MilvusClient(uri="http://localhost:19530")
    client.has_collection.return_value = True
    client.describe_collection.return_value = {
        "fields": [{"name": "id"}, {"name": "content"}, {"name": "metadata"}, {"name": "sparse_vector"}]
    }

    with patch.object(milvus_module.MilvusVector, "_init_client", return_value=client):
        with patch.object(milvus_module.MilvusVector, "_check_hybrid_search_support", return_value=False):
            vector = milvus_module.MilvusVector("collection_1", _config(milvus_module))

    assert "id" not in vector._fields
    assert "content" in vector._fields


def test_load_collection_fields_from_argument_and_remote(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._client = MagicMock()
    vector._collection_name = "collection_1"
    vector._client.describe_collection.return_value = {"fields": [{"name": "id"}, {"name": "content"}]}

    vector._load_collection_fields(["id", "metadata"])
    assert vector._fields == ["metadata"]

    vector._load_collection_fields()
    assert vector._fields == ["content"]


def test_check_hybrid_search_support_branches(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._client = MagicMock()

    vector._client_config = SimpleNamespace(enable_hybrid_search=False)
    assert vector._check_hybrid_search_support() is False

    vector._client_config = SimpleNamespace(enable_hybrid_search=True)
    vector._client.get_server_version.return_value = "Zilliz Cloud 2.4"
    assert vector._check_hybrid_search_support() is True

    vector._client.get_server_version.return_value = "2.5.1"
    assert vector._check_hybrid_search_support() is True

    vector._client.get_server_version.return_value = "2.4.9"
    assert vector._check_hybrid_search_support() is False

    vector._client.get_server_version.side_effect = RuntimeError("boom")
    assert vector._check_hybrid_search_support() is False


def test_get_type_and_create_delegate(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector.create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [SimpleNamespace(page_content="hello", metadata=None)]

    vector.create(docs, [[0.1, 0.2]])

    assert vector.get_type() == "milvus"
    vector.create_collection.assert_called_once()
    create_args = vector.create_collection.call_args.args
    assert create_args[0] == [[0.1, 0.2]]
    assert create_args[1] == [{}]
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_add_texts_batches_and_raises_milvus_exception(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    vector._client.insert.side_effect = [["id-1"], ["id-2"]]
    docs = [Document(page_content=f"text-{i}", metadata={"doc_id": f"d-{i}"}) for i in range(1001)]
    embeddings = [[0.1, 0.2] for _ in range(1001)]

    ids = vector.add_texts(docs, embeddings)
    assert ids == ["id-1", "id-2"]
    assert vector._client.insert.call_count == 2

    vector._client.insert.side_effect = milvus_module.MilvusException("insert failed")
    with pytest.raises(milvus_module.MilvusException):
        vector.add_texts([Document(page_content="x", metadata={})], [[0.1]])


def test_get_ids_and_delete_methods(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    vector._client.query.return_value = [{"id": 1}, {"id": 2}]

    assert vector.get_ids_by_metadata_field("document_id", "doc-1") == [1, 2]
    vector._client.query.return_value = []
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") is None

    vector._client.has_collection.return_value = True
    vector.get_ids_by_metadata_field = MagicMock(return_value=[101, 102])
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.delete.assert_called_with(collection_name="collection_1", pks=[101, 102])

    vector._client.delete.reset_mock()
    vector._client.query.return_value = [{"id": 11}, {"id": 12}]
    vector.delete_by_ids(["doc-a", "doc-b"])
    vector._client.delete.assert_called_with(collection_name="collection_1", pks=[11, 12])

    vector._client.has_collection.return_value = True
    vector.delete()
    vector._client.drop_collection.assert_called_once_with("collection_1", None)


def test_text_exists_and_field_exists(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._collection_name = "collection_1"
    vector._fields = ["content", "metadata"]
    vector._client = MagicMock()
    vector._client.has_collection.return_value = False
    assert vector.text_exists("doc-1") is False

    vector._client.has_collection.return_value = True
    vector._client.query.return_value = [{"id": 1}]
    assert vector.text_exists("doc-1") is True
    vector._client.query.return_value = []
    assert vector.text_exists("doc-1") is False
    assert vector.field_exists("content") is True
    assert vector.field_exists("unknown") is False


def test_process_search_results_and_search_methods(milvus_module):
    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    vector._fields = ["content", "metadata", "sparse_vector"]

    processed = vector._process_search_results(
        [
            [
                {"entity": {"content": "doc-1", "metadata": {"doc_id": "1"}}, "distance": 0.9},
                {"entity": {"content": "doc-2", "metadata": {"doc_id": "2"}}, "distance": 0.2},
            ]
        ],
        [milvus_module.Field.CONTENT_KEY, milvus_module.Field.METADATA_KEY],
        score_threshold=0.5,
    )
    assert len(processed) == 1
    assert processed[0].metadata["score"] == 0.9

    vector._client.search.return_value = [[{"entity": {"content": "doc"}, "distance": 0.8}]]
    vector._process_search_results = MagicMock(return_value=["doc"])

    docs = vector.search_by_vector([0.1, 0.2], top_k=3, document_ids_filter=["a", "b"], score_threshold=0.1)
    assert docs == ["doc"]
    assert vector._client.search.call_args.kwargs["filter"] == 'metadata["document_id"] in ["a", "b"]'

    vector._hybrid_search_enabled = False
    assert vector.search_by_full_text("query") == []

    vector._hybrid_search_enabled = True
    vector._fields = []
    assert vector.search_by_full_text("query") == []

    vector._fields = [milvus_module.Field.SPARSE_VECTOR]
    vector._process_search_results = MagicMock(return_value=["full-text-doc"])
    full_text_docs = vector.search_by_full_text("query", top_k=2, document_ids_filter=["d-1"], score_threshold=0.2)
    assert full_text_docs == ["full-text-doc"]
    assert "document_id" in vector._client.search.call_args.kwargs["filter"]


def test_create_collection_cache_and_existing_collection(milvus_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(milvus_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(milvus_module.redis_client, "set", MagicMock())

    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._collection_name = "collection_1"
    vector._consistency_level = "Session"
    vector._client_config = _config(milvus_module)
    vector._hybrid_search_enabled = False
    vector._client = MagicMock()

    monkeypatch.setattr(milvus_module.redis_client, "get", MagicMock(return_value=1))
    vector.create_collection([[0.1, 0.2]], metadatas=[{"doc_id": "1"}], index_params={"index_type": "HNSW"})
    vector._client.create_collection.assert_not_called()

    monkeypatch.setattr(milvus_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.has_collection.return_value = True
    vector.create_collection([[0.1, 0.2]], metadatas=[{"doc_id": "1"}], index_params={"index_type": "HNSW"})
    milvus_module.redis_client.set.assert_called()


def test_create_collection_builds_schema_and_indexes(milvus_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(milvus_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(milvus_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(milvus_module.redis_client, "set", MagicMock())

    vector = milvus_module.MilvusVector.__new__(milvus_module.MilvusVector)
    vector._collection_name = "collection_1"
    vector._consistency_level = "Session"
    vector._client = MagicMock()
    vector._client.has_collection.return_value = False
    vector._load_collection_fields = MagicMock()

    vector._client_config = _config(milvus_module, analyzer_params='{"tokenizer":"standard"}')
    vector._hybrid_search_enabled = True
    vector.create_collection(
        embeddings=[[0.1, 0.2]],
        metadatas=[{"doc_id": "1"}],
        index_params={"metric_type": "IP", "index_type": "HNSW", "params": {"M": 8}},
    )

    call_kwargs = vector._client.create_collection.call_args.kwargs
    schema = call_kwargs["schema"]
    index_params_obj = call_kwargs["index_params"]
    field_names = [f.name for f in schema.fields]

    assert milvus_module.Field.SPARSE_VECTOR in field_names
    assert len(schema.functions) == 1
    assert len(index_params_obj.indexes) == 2
    assert call_kwargs["consistency_level"] == "Session"


def test_factory_initializes_milvus_vector(milvus_module, monkeypatch):
    factory = milvus_module.MilvusVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(milvus_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(milvus_module.dify_config, "MILVUS_URI", "http://localhost:19530")
    monkeypatch.setattr(milvus_module.dify_config, "MILVUS_TOKEN", "")
    monkeypatch.setattr(milvus_module.dify_config, "MILVUS_USER", "root")
    monkeypatch.setattr(milvus_module.dify_config, "MILVUS_PASSWORD", "Milvus")
    monkeypatch.setattr(milvus_module.dify_config, "MILVUS_DATABASE", "default")
    monkeypatch.setattr(milvus_module.dify_config, "MILVUS_ENABLE_HYBRID_SEARCH", True)
    monkeypatch.setattr(milvus_module.dify_config, "MILVUS_ANALYZER_PARAMS", '{"tokenizer":"standard"}')

    with patch.object(milvus_module, "MilvusVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
