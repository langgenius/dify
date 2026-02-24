import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_tencent_modules():
    tcvdb_text = types.ModuleType("tcvdb_text")
    tcvdb_text_encoder = types.ModuleType("tcvdb_text.encoder")
    tcvectordb = types.ModuleType("tcvectordb")
    tcvectordb_model = types.ModuleType("tcvectordb.model")
    tcvectordb_document = types.ModuleType("tcvectordb.model.document")
    tcvectordb_index = types.ModuleType("tcvectordb.model.index")
    tcvectordb_enum = types.ModuleType("tcvectordb.model.enum")

    class _BM25Encoder:
        def encode_texts(self, text):
            return {"encoded_text": text}

        def encode_queries(self, query):
            return {"encoded_query": query}

        @classmethod
        def default(cls, _lang):
            return cls()

    class VectorDBError(Exception):
        def __init__(self, message):
            super().__init__(message)
            self.message = message

    class RPCVectorDBClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.create_database_if_not_exists = MagicMock()
            self.exists_collection = MagicMock(return_value=False)
            self.describe_collection = MagicMock(return_value=SimpleNamespace(indexes=[]))
            self.create_collection = MagicMock()
            self.upsert = MagicMock()
            self.query = MagicMock(return_value=[])
            self.delete = MagicMock()
            self.search = MagicMock(return_value=[])
            self.hybrid_search = MagicMock(return_value=[])
            self.drop_collection = MagicMock()

    class _Document:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class _HNSWSearchParams:
        def __init__(self, ef):
            self.ef = ef

    class _AnnSearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _KeywordSearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _WeightedRerank:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _Filter:
        @staticmethod
        def in_(field, values):
            return ("in", field, values)

        def __init__(self, condition):
            self.condition = condition

    _Filter.In = staticmethod(_Filter.in_)

    class _HNSWParams:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _FilterIndex:
        def __init__(self, *args):
            self.args = args

    class _VectorIndex:
        def __init__(self, *args):
            self.args = args

    class _SparseIndex:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    tcvectordb_enum.IndexType = SimpleNamespace(
        __members__={"HNSW": "HNSW", "PRIMARY_KEY": "PRIMARY_KEY", "FILTER": "FILTER", "SPARSE_INVERTED": "SPARSE"},
        PRIMARY_KEY="PRIMARY_KEY",
        FILTER="FILTER",
        SPARSE_INVERTED="SPARSE",
    )
    tcvectordb_enum.MetricType = SimpleNamespace(__members__={"IP": "IP"}, IP="IP")
    tcvectordb_enum.FieldType = SimpleNamespace(String="String", Json="Json", SparseVector="SparseVector")

    tcvectordb_document.Document = _Document
    tcvectordb_document.HNSWSearchParams = _HNSWSearchParams
    tcvectordb_document.AnnSearch = _AnnSearch
    tcvectordb_document.Filter = _Filter
    tcvectordb_document.KeywordSearch = _KeywordSearch
    tcvectordb_document.WeightedRerank = _WeightedRerank

    tcvectordb_index.HNSWParams = _HNSWParams
    tcvectordb_index.FilterIndex = _FilterIndex
    tcvectordb_index.VectorIndex = _VectorIndex
    tcvectordb_index.SparseIndex = _SparseIndex

    tcvdb_text_encoder.BM25Encoder = _BM25Encoder

    tcvectordb_model.document = tcvectordb_document
    tcvectordb_model.enum = tcvectordb_enum
    tcvectordb_model.index = tcvectordb_index

    tcvectordb.RPCVectorDBClient = RPCVectorDBClient
    tcvectordb.VectorDBException = VectorDBError

    return {
        "tcvdb_text": tcvdb_text,
        "tcvdb_text.encoder": tcvdb_text_encoder,
        "tcvectordb": tcvectordb,
        "tcvectordb.model": tcvectordb_model,
        "tcvectordb.model.document": tcvectordb_document,
        "tcvectordb.model.index": tcvectordb_index,
        "tcvectordb.model.enum": tcvectordb_enum,
    }


@pytest.fixture
def tencent_module(monkeypatch):
    for name, module in _build_fake_tencent_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.tencent.tencent_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "url": "http://vdb.local",
        "api_key": "api-key",
        "timeout": 30,
        "username": "user",
        "database": "db",
        "index_type": "HNSW",
        "metric_type": "IP",
        "shard": 1,
        "replicas": 2,
        "max_upsert_batch_size": 2,
        "enable_hybrid_search": False,
    }
    values.update(overrides)
    return module.TencentConfig.model_validate(values)


def test_config_and_init_paths(tencent_module):
    config = _config(tencent_module)
    assert config.to_tencent_params()["url"] == "http://vdb.local"

    vector = tencent_module.TencentVector("collection_1", config)
    assert vector.get_type() == tencent_module.VectorType.TENCENT
    assert vector._client.kwargs["key"] == "api-key"

    vector._client.exists_collection.return_value = True
    vector._client.describe_collection.return_value = SimpleNamespace(
        indexes=[SimpleNamespace(name="vector", dimension=768), SimpleNamespace(name="sparse_vector", dimension=0)]
    )
    vector._client_config.enable_hybrid_search = True
    vector._load_collection()
    assert vector._enable_hybrid_search is True
    assert vector._dimension == 768

    vector._client.describe_collection.return_value = SimpleNamespace(
        indexes=[SimpleNamespace(name="vector", dimension=512)]
    )
    vector._load_collection()
    assert vector._enable_hybrid_search is False


def test_create_collection_branches(tencent_module, monkeypatch):
    vector = tencent_module.TencentVector("collection_1", _config(tencent_module))

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(tencent_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(tencent_module.redis_client, "set", MagicMock())

    monkeypatch.setattr(tencent_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(3)
    vector._client.create_collection.assert_not_called()

    monkeypatch.setattr(tencent_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.exists_collection.return_value = True
    vector._create_collection(3)
    vector._client.create_collection.assert_not_called()

    vector._client.exists_collection.return_value = False
    vector._client_config.index_type = "UNKNOWN"
    with pytest.raises(ValueError, match="unsupported index_type"):
        vector._create_collection(3)

    vector._client_config.index_type = "HNSW"
    vector._client_config.metric_type = "UNKNOWN"
    with pytest.raises(ValueError, match="unsupported metric_type"):
        vector._create_collection(3)

    vector._client_config.metric_type = "IP"
    vector._client.create_collection.side_effect = [
        tencent_module.VectorDBException("fieldType:json unsupported"),
        None,
    ]
    vector._enable_hybrid_search = True
    vector._create_collection(3)
    assert vector._client.create_collection.call_count == 2
    tencent_module.redis_client.set.assert_called_once()
    vector._client.create_collection.side_effect = None


def test_create_add_delete_and_search_behaviour(tencent_module):
    vector = tencent_module.TencentVector("collection_1", _config(tencent_module, enable_hybrid_search=True))
    vector._create_collection = MagicMock()
    docs = [
        Document(page_content="text-a", metadata={"doc_id": "a", "document_id": "doc-a"}),
        Document(page_content="text-b", metadata={"doc_id": "b", "document_id": "doc-b"}),
        Document(page_content="text-c", metadata={"doc_id": "c", "document_id": "doc-c"}),
    ]
    embeddings = [[0.1], [0.2], [0.3]]
    vector.create(docs, embeddings)
    vector._create_collection.assert_called_once_with(1)

    vector._client.upsert.reset_mock()
    vector.add_texts(docs, embeddings)
    assert vector._client.upsert.call_count == 2
    first_docs = vector._client.upsert.call_args_list[0].kwargs["documents"]
    assert "sparse_vector" in first_docs[0].__dict__

    vector._client.query.return_value = [{"id": "a"}]
    assert vector.text_exists("a") is True
    vector._client.query.return_value = []
    assert vector.text_exists("a") is False

    vector.delete_by_ids([])
    vector._client.delete.assert_not_called()
    vector.delete_by_ids(["a", "b", "c"])
    assert vector._client.delete.call_count == 2
    vector.delete_by_metadata_field("document_id", "doc-a")
    assert vector._client.delete.call_count >= 3

    vector._client.search.return_value = [[{"metadata": {"doc_id": "1"}, "text": "vec-doc", "score": 0.9}]]
    vec_docs = vector.search_by_vector([0.1], top_k=2, score_threshold=0.5, document_ids_filter=["doc-a"])
    assert len(vec_docs) == 1
    assert vec_docs[0].metadata["score"] == pytest.approx(0.9)

    vector._enable_hybrid_search = False
    assert vector.search_by_full_text("query") == []
    vector._enable_hybrid_search = True
    vector._client.hybrid_search.return_value = [[{"metadata": {"doc_id": "2"}, "text": "fts-doc", "score": 0.8}]]
    fts_docs = vector.search_by_full_text("query", top_k=2, score_threshold=0.5, document_ids_filter=["doc-a"])
    assert len(fts_docs) == 1

    # _get_search_res handles old string metadata format
    compat_docs = vector._get_search_res([[{"metadata": '{"doc_id": "3"}', "text": "compat", "score": 0.2}]], 0.5)
    assert len(compat_docs) == 1
    assert compat_docs[0].metadata["score"] == pytest.approx(0.8)

    vector._has_collection = MagicMock(return_value=True)
    vector.delete()
    vector._client.drop_collection.assert_called_once()


def test_tencent_factory_existing_and_generated_collection(tencent_module, monkeypatch):
    factory = tencent_module.TencentVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(tencent_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_URL", "http://vdb.local")
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_API_KEY", "api-key")
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_TIMEOUT", 30)
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_USERNAME", "user")
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_DATABASE", "db")
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_SHARD", 1)
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_REPLICAS", 2)
    monkeypatch.setattr(tencent_module.dify_config, "TENCENT_VECTOR_DB_ENABLE_HYBRID_SEARCH", True)

    with patch.object(tencent_module, "TencentVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None
