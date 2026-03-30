import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from core.rag.models.document import Document


def _build_fake_pyobvector_module():
    pyobvector = types.ModuleType("pyobvector")

    class VECTOR:
        def __init__(self, dim):
            self.dim = dim

    def l2_distance(*_args, **_kwargs):
        return "l2"

    def cosine_distance(*_args, **_kwargs):
        return "cosine"

    def inner_product(*_args, **_kwargs):
        return "inner_product"

    class ObVecClient:
        def __init__(self, **_kwargs):
            self.metadata_obj = SimpleNamespace(tables={})
            self.engine = MagicMock()
            self.check_table_exists = MagicMock(return_value=False)
            self.perform_raw_text_sql = MagicMock()
            self.prepare_index_params = MagicMock()
            self.create_table_with_index_params = MagicMock()
            self.refresh_metadata = MagicMock()
            self.insert = MagicMock()
            self.refresh_index = MagicMock()
            self.get = MagicMock()
            self.delete = MagicMock()
            self.set_ob_hnsw_ef_search = MagicMock()
            self.ann_search = MagicMock(return_value=[])
            self.drop_table_if_exist = MagicMock()

    pyobvector.VECTOR = VECTOR
    pyobvector.ObVecClient = ObVecClient
    pyobvector.l2_distance = l2_distance
    pyobvector.cosine_distance = cosine_distance
    pyobvector.inner_product = inner_product
    return pyobvector


@pytest.fixture
def oceanbase_module(monkeypatch):
    monkeypatch.setitem(sys.modules, "pyobvector", _build_fake_pyobvector_module())

    import core.rag.datasource.vdb.oceanbase.oceanbase_vector as module

    return importlib.reload(module)


def _config(module):
    return module.OceanBaseVectorConfig(
        host="127.0.0.1",
        port=2881,
        user="root",
        password="secret",
        database="test",
        enable_hybrid_search=True,
        batch_size=10,
    )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config OCEANBASE_VECTOR_HOST is required"),
        ("port", 0, "config OCEANBASE_VECTOR_PORT is required"),
        ("user", "", "config OCEANBASE_VECTOR_USER is required"),
        ("database", "", "config OCEANBASE_VECTOR_DATABASE is required"),
    ],
)
def test_oceanbase_config_validation(oceanbase_module, field, value, message):
    values = _config(oceanbase_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        oceanbase_module.OceanBaseVectorConfig.model_validate(values)


def test_init_rejects_invalid_collection_name(oceanbase_module):
    with pytest.raises(ValueError, match="Invalid collection name"):
        oceanbase_module.OceanBaseVector("invalid-name", _config(oceanbase_module))


def test_distance_to_score_for_supported_metrics(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._config = SimpleNamespace(metric_type="l2")
    assert vector._distance_to_score(3.0) == pytest.approx(0.25)

    vector._config = SimpleNamespace(metric_type="cosine")
    assert vector._distance_to_score(0.2) == pytest.approx(0.8)

    vector._config = SimpleNamespace(metric_type="inner_product")
    assert vector._distance_to_score(-0.2) == pytest.approx(0.2)


def test_get_distance_func_raises_for_unknown_metric(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._config = SimpleNamespace(metric_type="manhattan")

    with pytest.raises(ValueError, match="Unsupported metric_type"):
        vector._get_distance_func()


def test_process_search_results_handles_json_and_score_threshold(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    rows = [
        ("doc-1", '{"doc_id":"1"}', 0.9),
        ("doc-2", "not-json", 0.8),
        ("doc-3", {"doc_id": "3"}, 0.3),
    ]

    docs = vector._process_search_results(rows, score_threshold=0.5, score_key="rank")

    assert len(docs) == 2
    assert docs[0].metadata["doc_id"] == "1"
    assert docs[0].metadata["rank"] == 0.9
    assert docs[1].metadata["rank"] == 0.8


def test_search_by_vector_validates_document_id_format(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._hnsw_ef_search = -1
    vector._config = SimpleNamespace(metric_type="cosine")
    vector._client = MagicMock()

    with pytest.raises(ValueError, match="Invalid document ID format"):
        vector.search_by_vector([0.1, 0.2], document_ids_filter=["bad id"])


def test_search_by_full_text_returns_empty_when_disabled(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._hybrid_search_enabled = False
    vector._collection_name = "collection_1"

    assert vector.search_by_full_text("query") == []


def test_check_hybrid_search_support_uses_version_comment(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._config = SimpleNamespace(enable_hybrid_search=True)
    vector._client = MagicMock()
    cursor = MagicMock()
    cursor.fetchone.return_value = ("OceanBase_CE 4.3.5.1 (rxxxxxxxxx) (Built Mar 18 2025)",)
    vector._client.perform_raw_text_sql.return_value = cursor

    assert vector._check_hybrid_search_support() is True

    cursor.fetchone.return_value = ("OceanBase_CE 4.3.4.0 (rxxxxxxxxx) (Built Mar 18 2025)",)
    assert vector._check_hybrid_search_support() is False


def test_init_get_type_and_field_loading(oceanbase_module):
    config = _config(oceanbase_module)
    config.enable_hybrid_search = False

    table = SimpleNamespace(columns=[SimpleNamespace(name="id"), SimpleNamespace(name="text")])
    fake_client = oceanbase_module.ObVecClient()
    fake_client.check_table_exists.return_value = True
    fake_client.metadata_obj.tables = {"collection_1": table}

    with patch.object(oceanbase_module, "ObVecClient", return_value=fake_client):
        vector = oceanbase_module.OceanBaseVector("collection_1", config)

    assert vector.get_type() == "oceanbase"
    assert vector.field_exists("text") is True


def test_load_collection_fields_handles_missing_table_and_exception(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._fields = []
    vector._client = MagicMock()
    vector._client.metadata_obj.tables = {}

    vector._load_collection_fields()
    assert vector._fields == []

    vector._client.metadata_obj.tables = {"collection_1": MagicMock(columns=MagicMock(side_effect=RuntimeError("x")))}
    vector._load_collection_fields()
    assert vector._fields == []


def test_create_delegates_to_collection_and_insert(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="text", metadata={"doc_id": "1"})]

    vector.create(docs, [[0.1, 0.2]])

    assert vector._vec_dim == 2
    vector._create_collection.assert_called_once()
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_create_collection_cache_and_existing_table_short_circuits(oceanbase_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(oceanbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(oceanbase_module.redis_client, "set", MagicMock())

    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._vec_dim = 2
    vector._hybrid_search_enabled = False
    vector._config = SimpleNamespace(metric_type="cosine", hnsw_m=16, hnsw_ef_construction=64)
    vector._client = MagicMock()
    vector.delete = MagicMock()
    vector._load_collection_fields = MagicMock()

    monkeypatch.setattr(oceanbase_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection()
    vector._client.check_table_exists.assert_not_called()

    monkeypatch.setattr(oceanbase_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.check_table_exists.return_value = True
    vector._create_collection()
    vector.delete.assert_not_called()


def test_create_collection_happy_path_with_hybrid_and_index(oceanbase_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(oceanbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(oceanbase_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(oceanbase_module.redis_client, "set", MagicMock())
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_FULLTEXT_PARSER", "ik")
    monkeypatch.setattr(oceanbase_module, "Column", lambda *args, **kwargs: SimpleNamespace(args=args, kwargs=kwargs))
    monkeypatch.setattr(oceanbase_module, "VECTOR", lambda dim: SimpleNamespace(dim=dim))

    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._vec_dim = 3
    vector._hybrid_search_enabled = True
    vector._config = SimpleNamespace(metric_type="cosine", hnsw_m=16, hnsw_ef_construction=64)
    vector._client = MagicMock()
    vector._client.check_table_exists.return_value = False
    vector._client.perform_raw_text_sql.side_effect = [
        [[None, None, None, None, None, None, "30"]],
        None,
        None,
    ]
    index_params = MagicMock()
    vector._client.prepare_index_params.return_value = index_params
    vector.delete = MagicMock()
    vector._load_collection_fields = MagicMock()

    vector._create_collection()

    vector.delete.assert_called_once()
    vector._client.create_table_with_index_params.assert_called_once()
    index_params.add_index.assert_called_once()
    vector._client.refresh_metadata.assert_called_once_with(["collection_1"])
    oceanbase_module.redis_client.set.assert_called_once()


def test_create_collection_error_paths(oceanbase_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(oceanbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(oceanbase_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(oceanbase_module, "Column", lambda *args, **kwargs: SimpleNamespace(args=args, kwargs=kwargs))
    monkeypatch.setattr(oceanbase_module, "VECTOR", lambda dim: SimpleNamespace(dim=dim))

    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._vec_dim = 2
    vector._hybrid_search_enabled = True
    vector._config = SimpleNamespace(metric_type="cosine", hnsw_m=16, hnsw_ef_construction=64)
    vector._client = MagicMock()
    vector._client.check_table_exists.return_value = False
    vector._client.prepare_index_params.return_value = MagicMock()
    vector.delete = MagicMock()
    vector._load_collection_fields = MagicMock()

    vector._client.perform_raw_text_sql.return_value = []
    with pytest.raises(ValueError, match="ob_vector_memory_limit_percentage not found"):
        vector._create_collection()

    vector._client.perform_raw_text_sql.side_effect = [
        [[None, None, None, None, None, None, "0"]],
        RuntimeError("no privilege"),
    ]
    with pytest.raises(Exception, match="Failed to set ob_vector_memory_limit_percentage"):
        vector._create_collection()

    vector._client.perform_raw_text_sql.side_effect = [[[None, None, None, None, None, None, "30"]]]
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_FULLTEXT_PARSER", "not-valid")
    with pytest.raises(ValueError, match="Invalid OceanBase full-text parser"):
        vector._create_collection()


def test_create_collection_fulltext_and_metadata_index_exceptions(oceanbase_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(oceanbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(oceanbase_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(oceanbase_module.redis_client, "set", MagicMock())
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_FULLTEXT_PARSER", "ik")
    monkeypatch.setattr(oceanbase_module, "Column", lambda *args, **kwargs: SimpleNamespace(args=args, kwargs=kwargs))
    monkeypatch.setattr(oceanbase_module, "VECTOR", lambda dim: SimpleNamespace(dim=dim))

    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._vec_dim = 2
    vector._hybrid_search_enabled = True
    vector._config = SimpleNamespace(metric_type="cosine", hnsw_m=16, hnsw_ef_construction=64)
    vector._client = MagicMock()
    vector._client.check_table_exists.return_value = False
    vector._client.prepare_index_params.return_value = MagicMock()
    vector.delete = MagicMock()
    vector._load_collection_fields = MagicMock()

    vector._client.perform_raw_text_sql.side_effect = [
        [[None, None, None, None, None, None, "30"]],
        RuntimeError("fulltext failed"),
    ]
    with pytest.raises(Exception, match="Failed to add fulltext index"):
        vector._create_collection()

    vector._hybrid_search_enabled = False
    vector._client.perform_raw_text_sql.side_effect = [
        [[None, None, None, None, None, None, "30"]],
        SQLAlchemyError("metadata index failed"),
    ]
    vector._create_collection()
    vector._client.refresh_metadata.assert_called_once_with(["collection_1"])


def test_check_hybrid_search_support_false_and_exception(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._config = SimpleNamespace(enable_hybrid_search=False)
    vector._client = MagicMock()
    assert vector._check_hybrid_search_support() is False

    vector._config = SimpleNamespace(enable_hybrid_search=True)
    vector._client.perform_raw_text_sql.side_effect = RuntimeError("boom")
    assert vector._check_hybrid_search_support() is False


def test_add_texts_batches_refresh_and_exceptions(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._config = SimpleNamespace(batch_size=2, hnsw_refresh_threshold=2)
    vector._client = MagicMock()
    vector._get_uuids = MagicMock(return_value=["id-1", "id-2", "id-3"])
    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
        Document(page_content="c", metadata={"doc_id": "id-3"}),
    ]

    vector.add_texts(docs, [[0.1], [0.2], [0.3]])
    assert vector._client.insert.call_count == 2
    vector._client.refresh_index.assert_called_once()

    vector._client.insert.reset_mock()
    vector._client.refresh_index.reset_mock()
    vector._client.insert.side_effect = RuntimeError("insert failed")
    with pytest.raises(Exception, match="Failed to insert batch"):
        vector.add_texts([docs[0]], [[0.1]])

    vector._client.insert.side_effect = None
    vector._client.insert.return_value = None
    vector._client.refresh_index.side_effect = SQLAlchemyError("refresh failed")
    vector._config = SimpleNamespace(batch_size=10, hnsw_refresh_threshold=1)
    vector._get_uuids.return_value = ["id-1"]
    vector.add_texts([docs[0]], [[0.1]])


def test_text_exists_and_delete_by_ids(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    vector._client.get.return_value = SimpleNamespace(rowcount=1)
    assert vector.text_exists("id-1") is True

    vector._client.get.side_effect = RuntimeError("boom")
    with pytest.raises(Exception, match="Failed to check text existence"):
        vector.text_exists("id-1")

    vector.delete_by_ids([])
    vector._client.delete.assert_not_called()

    vector._client.delete.side_effect = None
    vector.delete_by_ids(["id-1"])
    vector._client.delete.assert_called_once()

    vector._client.delete.side_effect = RuntimeError("boom")
    with pytest.raises(Exception, match="Failed to delete documents"):
        vector.delete_by_ids(["id-1"])


def test_get_ids_and_delete_by_metadata_field(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    execute_result = [("id-1",), ("id-2",)]

    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = None
    conn.execute.return_value = execute_result
    vector._client.engine.connect.return_value = conn

    ids = vector.get_ids_by_metadata_field("document_id", "doc-1")
    assert ids == ["id-1", "id-2"]

    with pytest.raises(Exception, match="Failed to query documents by metadata field"):
        vector.get_ids_by_metadata_field("bad key!", "doc-1")

    vector.get_ids_by_metadata_field = MagicMock(return_value=["id-1"])
    vector.delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete_by_ids.assert_called_once_with(["id-1"])

    vector.get_ids_by_metadata_field = MagicMock(return_value=[])
    vector.delete_by_ids.reset_mock()
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete_by_ids.assert_not_called()


def test_search_by_full_text_paths(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._hybrid_search_enabled = True
    vector.field_exists = MagicMock(return_value=False)

    assert vector.search_by_full_text("query") == []

    vector.field_exists.return_value = True
    vector._client = MagicMock()
    conn = MagicMock()
    tx = MagicMock()
    tx.__enter__.return_value = tx
    tx.__exit__.return_value = None
    conn.begin.return_value = tx
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = None
    conn.execute.return_value.fetchall.return_value = [("text-1", '{"doc_id":"1"}', 0.9)]
    vector._client.engine.connect.return_value = conn

    docs = vector.search_by_full_text("query", top_k=2, document_ids_filter=["d-1"], score_threshold=0.5)
    assert len(docs) == 1
    assert docs[0].metadata["score"] == 0.9

    with pytest.raises(Exception, match="Full-text search failed"):
        vector.search_by_full_text("query", top_k=0)


def test_search_by_vector_paths(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._hnsw_ef_search = -1
    vector._config = SimpleNamespace(metric_type="cosine")
    vector._client = MagicMock()
    vector._client.ann_search.return_value = [("doc-1", '{"doc_id":"1"}', 0.2)]
    vector._process_search_results = MagicMock(return_value=["doc"])

    docs = vector.search_by_vector(
        [0.1, 0.2],
        ef_search=10,
        top_k=3,
        score_threshold=0.1,
        document_ids_filter=["good_id"],
    )
    assert docs == ["doc"]
    vector._client.set_ob_hnsw_ef_search.assert_called_once_with(10)

    with pytest.raises(ValueError, match="Invalid score_threshold parameter"):
        vector.search_by_vector([0.1], score_threshold="x")

    vector._client.ann_search.side_effect = RuntimeError("boom")
    with pytest.raises(Exception, match="Vector search failed"):
        vector.search_by_vector([0.1], score_threshold=0.1)


def test_get_distance_func_and_distance_to_score_errors(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._config = SimpleNamespace(metric_type="cosine")
    assert vector._get_distance_func() is oceanbase_module.cosine_distance

    vector._config = SimpleNamespace(metric_type="unknown")
    with pytest.raises(ValueError, match="Unsupported metric_type"):
        vector._distance_to_score(0.1)


def test_delete_success_and_exception(oceanbase_module):
    vector = oceanbase_module.OceanBaseVector.__new__(oceanbase_module.OceanBaseVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()

    vector.delete()
    vector._client.drop_table_if_exist.assert_called_once_with("collection_1")

    vector._client.drop_table_if_exist.side_effect = RuntimeError("boom")
    with pytest.raises(Exception, match="Failed to delete collection"):
        vector.delete()


def test_oceanbase_factory_uses_existing_or_generated_collection(oceanbase_module, monkeypatch):
    factory = oceanbase_module.OceanBaseVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(oceanbase_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_HOST", "127.0.0.1")
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_PORT", 2881)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_USER", "root")
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_PASSWORD", "password")
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_DATABASE", "test")
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_ENABLE_HYBRID_SEARCH", True)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_BATCH_SIZE", 10)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_METRIC_TYPE", "cosine")
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_HNSW_M", 16)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_HNSW_EF_CONSTRUCTION", 64)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_HNSW_EF_SEARCH", -1)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_POOL_SIZE", 5)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_VECTOR_MAX_OVERFLOW", 10)
    monkeypatch.setattr(oceanbase_module.dify_config, "OCEANBASE_HNSW_REFRESH_THRESHOLD", 1000)

    with patch.object(oceanbase_module, "OceanBaseVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].args[0] == "existing_collection"
    assert vector_cls.call_args_list[1].args[0] == "auto_collection"
    assert dataset_without_index.index_struct is not None
