import base64
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _register_fake_factory_module(monkeypatch, module_path: str, class_name: str):
    fake_module = types.ModuleType(module_path)
    fake_cls = type(class_name, (), {})
    setattr(fake_module, class_name, fake_cls)
    monkeypatch.setitem(sys.modules, module_path, fake_module)
    return fake_cls


@pytest.fixture
def vector_factory_module():
    import importlib

    import core.rag.datasource.vdb.vector_factory as module

    return importlib.reload(module)


def test_gen_index_struct_dict(vector_factory_module):
    result = vector_factory_module.AbstractVectorFactory.gen_index_struct_dict(
        vector_factory_module.VectorType.WEAVIATE,
        "collection_1",
    )

    assert result == {
        "type": vector_factory_module.VectorType.WEAVIATE,
        "vector_store": {"class_prefix": "collection_1"},
    }


@pytest.mark.parametrize(
    ("vector_type", "module_path", "class_name"),
    [
        ("CHROMA", "core.rag.datasource.vdb.chroma.chroma_vector", "ChromaVectorFactory"),
        ("MILVUS", "core.rag.datasource.vdb.milvus.milvus_vector", "MilvusVectorFactory"),
        (
            "ALIBABACLOUD_MYSQL",
            "core.rag.datasource.vdb.alibabacloud_mysql.alibabacloud_mysql_vector",
            "AlibabaCloudMySQLVectorFactory",
        ),
        ("MYSCALE", "core.rag.datasource.vdb.myscale.myscale_vector", "MyScaleVectorFactory"),
        ("PGVECTOR", "core.rag.datasource.vdb.pgvector.pgvector", "PGVectorFactory"),
        ("VASTBASE", "core.rag.datasource.vdb.pyvastbase.vastbase_vector", "VastbaseVectorFactory"),
        ("PGVECTO_RS", "core.rag.datasource.vdb.pgvecto_rs.pgvecto_rs", "PGVectoRSFactory"),
        ("QDRANT", "core.rag.datasource.vdb.qdrant.qdrant_vector", "QdrantVectorFactory"),
        ("RELYT", "core.rag.datasource.vdb.relyt.relyt_vector", "RelytVectorFactory"),
        (
            "ELASTICSEARCH",
            "core.rag.datasource.vdb.elasticsearch.elasticsearch_vector",
            "ElasticSearchVectorFactory",
        ),
        (
            "ELASTICSEARCH_JA",
            "core.rag.datasource.vdb.elasticsearch.elasticsearch_ja_vector",
            "ElasticSearchJaVectorFactory",
        ),
        ("TIDB_VECTOR", "core.rag.datasource.vdb.tidb_vector.tidb_vector", "TiDBVectorFactory"),
        ("WEAVIATE", "core.rag.datasource.vdb.weaviate.weaviate_vector", "WeaviateVectorFactory"),
        ("TENCENT", "core.rag.datasource.vdb.tencent.tencent_vector", "TencentVectorFactory"),
        ("ORACLE", "core.rag.datasource.vdb.oracle.oraclevector", "OracleVectorFactory"),
        (
            "OPENSEARCH",
            "core.rag.datasource.vdb.opensearch.opensearch_vector",
            "OpenSearchVectorFactory",
        ),
        ("ANALYTICDB", "core.rag.datasource.vdb.analyticdb.analyticdb_vector", "AnalyticdbVectorFactory"),
        ("COUCHBASE", "core.rag.datasource.vdb.couchbase.couchbase_vector", "CouchbaseVectorFactory"),
        ("BAIDU", "core.rag.datasource.vdb.baidu.baidu_vector", "BaiduVectorFactory"),
        ("VIKINGDB", "core.rag.datasource.vdb.vikingdb.vikingdb_vector", "VikingDBVectorFactory"),
        ("UPSTASH", "core.rag.datasource.vdb.upstash.upstash_vector", "UpstashVectorFactory"),
        (
            "TIDB_ON_QDRANT",
            "core.rag.datasource.vdb.tidb_on_qdrant.tidb_on_qdrant_vector",
            "TidbOnQdrantVectorFactory",
        ),
        ("LINDORM", "core.rag.datasource.vdb.lindorm.lindorm_vector", "LindormVectorStoreFactory"),
        ("OCEANBASE", "core.rag.datasource.vdb.oceanbase.oceanbase_vector", "OceanBaseVectorFactory"),
        ("SEEKDB", "core.rag.datasource.vdb.oceanbase.oceanbase_vector", "OceanBaseVectorFactory"),
        ("OPENGAUSS", "core.rag.datasource.vdb.opengauss.opengauss", "OpenGaussFactory"),
        ("TABLESTORE", "core.rag.datasource.vdb.tablestore.tablestore_vector", "TableStoreVectorFactory"),
        (
            "HUAWEI_CLOUD",
            "core.rag.datasource.vdb.huawei.huawei_cloud_vector",
            "HuaweiCloudVectorFactory",
        ),
        ("MATRIXONE", "core.rag.datasource.vdb.matrixone.matrixone_vector", "MatrixoneVectorFactory"),
        ("CLICKZETTA", "core.rag.datasource.vdb.clickzetta.clickzetta_vector", "ClickzettaVectorFactory"),
        ("IRIS", "core.rag.datasource.vdb.iris.iris_vector", "IrisVectorFactory"),
    ],
)
def test_get_vector_factory_supported(vector_factory_module, monkeypatch, vector_type, module_path, class_name):
    expected_cls = _register_fake_factory_module(monkeypatch, module_path, class_name)

    result_cls = vector_factory_module.Vector.get_vector_factory(getattr(vector_factory_module.VectorType, vector_type))

    assert result_cls is expected_cls


def test_get_vector_factory_unsupported(vector_factory_module):
    with pytest.raises(ValueError, match="not supported"):
        vector_factory_module.Vector.get_vector_factory("unknown")


def test_vector_init_uses_default_and_custom_attributes(vector_factory_module):
    dataset = SimpleNamespace(id="dataset-1")

    with (
        patch.object(vector_factory_module.Vector, "_get_embeddings", return_value="embeddings"),
        patch.object(vector_factory_module.Vector, "_init_vector", return_value="processor"),
    ):
        default_vector = vector_factory_module.Vector(dataset)
        custom_vector = vector_factory_module.Vector(dataset, attributes=["doc_id"])

    assert default_vector._attributes == ["doc_id", "dataset_id", "document_id", "doc_hash", "doc_type"]
    assert custom_vector._attributes == ["doc_id"]
    assert default_vector._embeddings == "embeddings"
    assert default_vector._vector_processor == "processor"


def test_init_vector_prefers_dataset_index_struct(vector_factory_module, monkeypatch):
    calls = {"vector_type": None, "init_args": None}

    class _Factory:
        def init_vector(self, dataset, attributes, embeddings):
            calls["init_args"] = (dataset, attributes, embeddings)
            return "vector-processor"

    monkeypatch.setattr(
        vector_factory_module.Vector,
        "get_vector_factory",
        staticmethod(lambda vector_type: calls.update(vector_type=vector_type) or _Factory),
    )

    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._dataset = SimpleNamespace(
        index_struct_dict={"type": vector_factory_module.VectorType.UPSTASH}, tenant_id="tenant-1"
    )
    vector._attributes = ["doc_id"]
    vector._embeddings = "embeddings"

    result = vector._init_vector()

    assert result == "vector-processor"
    assert calls["vector_type"] == vector_factory_module.VectorType.UPSTASH
    assert calls["init_args"] == (vector._dataset, ["doc_id"], "embeddings")


def test_init_vector_uses_whitelist_override(vector_factory_module, monkeypatch):
    class _Expr:
        def __eq__(self, _other):
            return "expr"

    calls = {"vector_type": None}

    class _Factory:
        def init_vector(self, dataset, attributes, embeddings):
            return "vector-processor"

    monkeypatch.setattr(vector_factory_module, "Whitelist", SimpleNamespace(tenant_id=_Expr(), category=_Expr()))
    monkeypatch.setattr(vector_factory_module, "select", lambda _model: SimpleNamespace(where=lambda *_args: "stmt"))
    monkeypatch.setattr(
        vector_factory_module,
        "db",
        SimpleNamespace(session=SimpleNamespace(scalars=lambda _stmt: SimpleNamespace(one_or_none=lambda: object()))),
    )
    monkeypatch.setattr(vector_factory_module.dify_config, "VECTOR_STORE", vector_factory_module.VectorType.CHROMA)
    monkeypatch.setattr(vector_factory_module.dify_config, "VECTOR_STORE_WHITELIST_ENABLE", True)
    monkeypatch.setattr(
        vector_factory_module.Vector,
        "get_vector_factory",
        staticmethod(lambda vector_type: calls.update(vector_type=vector_type) or _Factory),
    )

    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._dataset = SimpleNamespace(index_struct_dict=None, tenant_id="tenant-1")
    vector._attributes = ["doc_id"]
    vector._embeddings = "embeddings"

    result = vector._init_vector()

    assert result == "vector-processor"
    assert calls["vector_type"] == vector_factory_module.VectorType.TIDB_ON_QDRANT


def test_init_vector_raises_when_vector_store_missing(vector_factory_module, monkeypatch):
    monkeypatch.setattr(vector_factory_module.dify_config, "VECTOR_STORE", None)
    monkeypatch.setattr(vector_factory_module.dify_config, "VECTOR_STORE_WHITELIST_ENABLE", False)

    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._dataset = SimpleNamespace(index_struct_dict=None, tenant_id="tenant-1")
    vector._attributes = []
    vector._embeddings = "embeddings"

    with pytest.raises(ValueError, match="Vector store must be specified"):
        vector._init_vector()


def test_create_batches_texts_and_skips_empty_input(vector_factory_module):
    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._embeddings = MagicMock()
    vector._vector_processor = MagicMock()

    docs = [Document(page_content=f"doc-{i}", metadata={"doc_id": f"id-{i}"}) for i in range(1001)]
    vector._embeddings.embed_documents.side_effect = [
        [[0.1] for _ in range(1000)],
        [[0.2]],
    ]

    vector.create(texts=docs, trace_id="trace-1")

    assert vector._embeddings.embed_documents.call_count == 2
    assert vector._vector_processor.create.call_count == 2
    assert vector._vector_processor.create.call_args_list[0].kwargs["trace_id"] == "trace-1"

    vector._embeddings.embed_documents.reset_mock()
    vector._vector_processor.create.reset_mock()
    vector.create(texts=None)
    vector._embeddings.embed_documents.assert_not_called()
    vector._vector_processor.create.assert_not_called()


def test_create_multimodal_filters_missing_uploads(vector_factory_module, monkeypatch):
    class _Field:
        def in_(self, value):
            return value

        def __eq__(self, value):
            return value

    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._embeddings = MagicMock()
    vector._embeddings.embed_multimodal_documents.return_value = [[0.1, 0.2]]
    vector._vector_processor = MagicMock()

    monkeypatch.setattr(vector_factory_module, "UploadFile", SimpleNamespace(id=_Field()))
    monkeypatch.setattr(vector_factory_module, "select", lambda _model: SimpleNamespace(where=lambda *_args: "stmt"))
    monkeypatch.setattr(
        vector_factory_module,
        "db",
        SimpleNamespace(
            session=SimpleNamespace(
                scalars=lambda _stmt: SimpleNamespace(all=lambda: [SimpleNamespace(id="f-1", key="k-1")])
            )
        ),
    )
    monkeypatch.setattr(vector_factory_module.storage, "load_once", MagicMock(return_value=b"abc"))

    docs = [
        Document(page_content="file-1", metadata={"doc_id": "f-1", "doc_type": "image"}),
        Document(page_content="file-2", metadata={"doc_id": "f-2", "doc_type": "image"}),
    ]

    vector.create_multimodal(file_documents=docs, request_id="r-1")

    file_base64 = base64.b64encode(b"abc").decode()
    vector._embeddings.embed_multimodal_documents.assert_called_once_with(
        [{"content": file_base64, "content_type": "image", "file_id": "f-1"}]
    )
    vector._vector_processor.create.assert_called_once_with(
        texts=[docs[0]],
        embeddings=[[0.1, 0.2]],
        request_id="r-1",
    )

    vector._embeddings.embed_multimodal_documents.reset_mock()
    vector._vector_processor.create.reset_mock()
    vector.create_multimodal(file_documents=None)
    vector._embeddings.embed_multimodal_documents.assert_not_called()
    vector._vector_processor.create.assert_not_called()


def test_add_texts_with_optional_duplicate_check(vector_factory_module):
    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._embeddings = MagicMock()
    vector._vector_processor = MagicMock()
    vector._filter_duplicate_texts = MagicMock()

    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
    ]
    vector._filter_duplicate_texts.return_value = [docs[0]]
    vector._embeddings.embed_documents.return_value = [[0.1]]

    vector.add_texts(docs, duplicate_check=True, flag=True)

    vector._filter_duplicate_texts.assert_called_once_with(docs)
    vector._vector_processor.create.assert_called_once_with(
        texts=[docs[0]], embeddings=[[0.1]], duplicate_check=True, flag=True
    )

    vector._filter_duplicate_texts.reset_mock()
    vector._vector_processor.create.reset_mock()
    vector._embeddings.embed_documents.return_value = [[0.2], [0.3]]

    vector.add_texts(docs, duplicate_check=False)

    vector._filter_duplicate_texts.assert_not_called()
    vector._vector_processor.create.assert_called_once()


def test_vector_delegation_methods(vector_factory_module):
    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._embeddings = MagicMock()
    vector._embeddings.embed_query.return_value = [0.1, 0.2]
    vector._vector_processor = MagicMock()
    vector._vector_processor.text_exists.return_value = True
    vector._vector_processor.search_by_vector.return_value = ["vector-doc"]
    vector._vector_processor.search_by_full_text.return_value = ["text-doc"]

    assert vector.text_exists("doc-1") is True
    vector.delete_by_ids(["doc-1"])
    vector.delete_by_metadata_field("doc_id", "doc-1")
    assert vector.search_by_vector("hello", top_k=3) == ["vector-doc"]
    assert vector.search_by_full_text("hello", top_k=3) == ["text-doc"]

    vector._vector_processor.delete_by_ids.assert_called_once_with(["doc-1"])
    vector._vector_processor.delete_by_metadata_field.assert_called_once_with("doc_id", "doc-1")


def test_search_by_file_handles_missing_and_existing_upload(vector_factory_module, monkeypatch):
    class _Field:
        def __eq__(self, value):
            return value

    upload_query = MagicMock()
    upload_query.where.return_value = upload_query

    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._embeddings = MagicMock()
    vector._vector_processor = MagicMock()

    monkeypatch.setattr(vector_factory_module, "UploadFile", SimpleNamespace(id=_Field()))
    monkeypatch.setattr(
        vector_factory_module, "db", SimpleNamespace(session=SimpleNamespace(query=lambda _model: upload_query))
    )

    upload_query.first.return_value = None
    assert vector.search_by_file("file-1") == []

    upload_query.first.return_value = SimpleNamespace(key="blob-key")
    monkeypatch.setattr(vector_factory_module.storage, "load_once", MagicMock(return_value=b"file-bytes"))
    vector._embeddings.embed_multimodal_query.return_value = [0.3, 0.4]
    vector._vector_processor.search_by_vector.return_value = ["hit"]

    result = vector.search_by_file("file-2", top_k=2)

    assert result == ["hit"]
    payload = vector._embeddings.embed_multimodal_query.call_args.args[0]
    assert payload["content_type"] == vector_factory_module.DocType.IMAGE
    assert payload["file_id"] == "file-2"


def test_delete_clears_redis_cache_when_collection_exists(vector_factory_module, monkeypatch):
    delete_mock = MagicMock()
    redis_delete = MagicMock()
    monkeypatch.setattr(vector_factory_module.redis_client, "delete", redis_delete)

    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._vector_processor = SimpleNamespace(delete=delete_mock, collection_name="collection_1")

    vector.delete()

    delete_mock.assert_called_once()
    redis_delete.assert_called_once_with("vector_indexing_collection_1")

    vector._vector_processor = SimpleNamespace(delete=delete_mock, collection_name="")
    redis_delete.reset_mock()
    vector.delete()
    redis_delete.assert_not_called()


def test_get_embeddings_builds_cache_embedding(vector_factory_module, monkeypatch):
    model_manager = MagicMock()
    model_manager.get_model_instance.return_value = "model-instance"

    monkeypatch.setattr(vector_factory_module, "ModelManager", MagicMock(return_value=model_manager))
    monkeypatch.setattr(vector_factory_module, "CacheEmbedding", MagicMock(return_value="cached-embedding"))

    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector._dataset = SimpleNamespace(
        tenant_id="tenant-1",
        embedding_model_provider="openai",
        embedding_model="text-embedding-3-small",
    )

    result = vector._get_embeddings()

    assert result == "cached-embedding"
    model_manager.get_model_instance.assert_called_once_with(
        tenant_id="tenant-1",
        provider="openai",
        model_type=vector_factory_module.ModelType.TEXT_EMBEDDING,
        model="text-embedding-3-small",
    )


def test_filter_duplicate_texts_and_getattr(vector_factory_module):
    vector = vector_factory_module.Vector.__new__(vector_factory_module.Vector)
    vector.text_exists = MagicMock(side_effect=lambda doc_id: doc_id == "dup")

    docs = [
        SimpleNamespace(page_content="no-meta", metadata=None),
        Document(page_content="empty-doc-id", metadata={"doc_id": ""}),
        Document(page_content="duplicate", metadata={"doc_id": "dup"}),
        Document(page_content="unique", metadata={"doc_id": "ok"}),
    ]

    filtered = vector._filter_duplicate_texts(docs)
    assert [doc.page_content for doc in filtered] == ["no-meta", "empty-doc-id", "unique"]

    class _Processor:
        def ping(self):
            return "pong"

    vector._vector_processor = _Processor()
    assert vector.ping() == "pong"

    with pytest.raises(AttributeError):
        _ = vector.unknown_method

    vector._vector_processor = None
    with pytest.raises(AttributeError, match="vector_processor"):
        _ = vector.another_missing
