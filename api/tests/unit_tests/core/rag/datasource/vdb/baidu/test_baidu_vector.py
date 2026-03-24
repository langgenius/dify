import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_pymochow_modules():
    pymochow = types.ModuleType("pymochow")
    pymochow.__path__ = []
    pymochow_auth = types.ModuleType("pymochow.auth")
    pymochow_auth.__path__ = []
    pymochow_credentials = types.ModuleType("pymochow.auth.bce_credentials")
    pymochow_configuration = types.ModuleType("pymochow.configuration")
    pymochow_exception = types.ModuleType("pymochow.exception")
    pymochow_model = types.ModuleType("pymochow.model")
    pymochow_model.__path__ = []
    pymochow_model_database = types.ModuleType("pymochow.model.database")
    pymochow_model_enum = types.ModuleType("pymochow.model.enum")
    pymochow_model_schema = types.ModuleType("pymochow.model.schema")
    pymochow_model_table = types.ModuleType("pymochow.model.table")

    class _SimpleObject:
        def __init__(self, *args, **kwargs):
            self.args = args
            for key, value in kwargs.items():
                setattr(self, key, value)

    class ServerError(Exception):
        def __init__(self, code):
            super().__init__(f"server error {code}")
            self.code = code

    class ServerErrCode:
        TABLE_NOT_EXIST = 1001
        DB_ALREADY_EXIST = 1002

    class IndexType:
        __members__ = {"HNSW": "HNSW"}

    class MetricType:
        __members__ = {"IP": "IP"}

    class IndexState:
        NORMAL = "NORMAL"

    class TableState:
        NORMAL = "NORMAL"

    class InvertedIndexAnalyzer:
        DEFAULT_ANALYZER = "DEFAULT_ANALYZER"

    class InvertedIndexParseMode:
        COARSE_MODE = "COARSE_MODE"

    class InvertedIndexFieldAttribute:
        ANALYZED = "ANALYZED"

    class FieldType:
        STRING = "STRING"
        TEXT = "TEXT"
        JSON = "JSON"
        FLOAT_VECTOR = "FLOAT_VECTOR"

    pymochow.MochowClient = _SimpleObject
    pymochow_credentials.BceCredentials = _SimpleObject
    pymochow_configuration.Configuration = _SimpleObject
    pymochow_exception.ServerError = ServerError
    pymochow_model_database.Database = _SimpleObject

    pymochow_model_enum.FieldType = FieldType
    pymochow_model_enum.IndexState = IndexState
    pymochow_model_enum.IndexType = IndexType
    pymochow_model_enum.MetricType = MetricType
    pymochow_model_enum.ServerErrCode = ServerErrCode
    pymochow_model_enum.TableState = TableState

    for cls_name in [
        "AutoBuildRowCountIncrement",
        "Field",
        "FilteringIndex",
        "HNSWParams",
        "InvertedIndex",
        "InvertedIndexParams",
        "Schema",
        "VectorIndex",
    ]:
        setattr(pymochow_model_schema, cls_name, _SimpleObject)
    pymochow_model_schema.InvertedIndexAnalyzer = InvertedIndexAnalyzer
    pymochow_model_schema.InvertedIndexFieldAttribute = InvertedIndexFieldAttribute
    pymochow_model_schema.InvertedIndexParseMode = InvertedIndexParseMode

    for cls_name in ["AnnSearch", "BM25SearchRequest", "HNSWSearchParams", "Partition", "Row"]:
        setattr(pymochow_model_table, cls_name, _SimpleObject)

    pymochow.auth = pymochow_auth
    pymochow.model = pymochow_model
    pymochow_auth.bce_credentials = pymochow_credentials
    pymochow_model.database = pymochow_model_database
    pymochow_model.enum = pymochow_model_enum
    pymochow_model.schema = pymochow_model_schema
    pymochow_model.table = pymochow_model_table

    modules = {
        "pymochow": pymochow,
        "pymochow.auth": pymochow_auth,
        "pymochow.auth.bce_credentials": pymochow_credentials,
        "pymochow.configuration": pymochow_configuration,
        "pymochow.exception": pymochow_exception,
        "pymochow.model": pymochow_model,
        "pymochow.model.database": pymochow_model_database,
        "pymochow.model.enum": pymochow_model_enum,
        "pymochow.model.schema": pymochow_model_schema,
        "pymochow.model.table": pymochow_model_table,
    }
    return modules


@pytest.fixture
def baidu_module(monkeypatch):
    for name, module in _build_fake_pymochow_modules().items():
        monkeypatch.setitem(sys.modules, name, module)
    import core.rag.datasource.vdb.baidu.baidu_vector as module

    return importlib.reload(module)


def test_baidu_config_validation(baidu_module):
    values = {
        "endpoint": "https://example.com",
        "account": "account",
        "api_key": "key",
        "database": "database",
    }
    config = baidu_module.BaiduConfig.model_validate(values)
    assert config.endpoint == "https://example.com"

    for key, error_message in [
        ("endpoint", "BAIDU_VECTOR_DB_ENDPOINT"),
        ("account", "BAIDU_VECTOR_DB_ACCOUNT"),
        ("api_key", "BAIDU_VECTOR_DB_API_KEY"),
        ("database", "BAIDU_VECTOR_DB_DATABASE"),
    ]:
        invalid = dict(values)
        invalid[key] = ""
        with pytest.raises(ValueError, match=error_message):
            baidu_module.BaiduConfig.model_validate(invalid)


def test_get_search_result_handles_metadata_and_threshold(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    response = SimpleNamespace(
        rows=[
            {"row": {"page_content": "doc1", "metadata": '{"document_id":"d1"}'}, "score": 0.9},
            {"row": {"page_content": "doc2", "metadata": {"document_id": "d2"}}, "score": 0.4},
            {"row": {"page_content": "doc3", "metadata": 123}, "score": 0.95},
        ]
    )

    docs = vector._get_search_res(response, score_threshold=0.8)

    assert len(docs) == 2
    assert docs[0].page_content == "doc1"
    assert docs[0].metadata["score"] == 0.9
    assert docs[1].page_content == "doc3"


def test_delete_by_ids_and_delete_by_metadata_field(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    table = MagicMock()
    vector._db = MagicMock()
    vector._db.table.return_value = table
    vector._collection_name = "collection_1"

    vector.delete_by_ids([])
    table.delete.assert_not_called()

    vector.delete_by_ids(["id1", "id2"])
    table.delete.assert_called_once()

    table.delete.reset_mock()
    vector.delete_by_metadata_field("source", 'abc"def')
    delete_filter = table.delete.call_args.kwargs["filter"]
    assert delete_filter == 'metadata["source"] = "abc\\"def"'


def test_delete_handles_table_not_exist_error_and_raises_for_other_codes(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = MagicMock()

    vector._db.drop_table.side_effect = baidu_module.ServerError(baidu_module.ServerErrCode.TABLE_NOT_EXIST)
    vector.delete()

    vector._db.drop_table.side_effect = baidu_module.ServerError(9999)
    with pytest.raises(baidu_module.ServerError):
        vector.delete()


def test_init_database_uses_existing_or_creates_when_missing(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._client = MagicMock()
    vector._client_config = SimpleNamespace(database="my_db")

    vector._client.list_databases.return_value = [SimpleNamespace(database_name="my_db")]
    vector._client.database.return_value = "existing_db"
    assert vector._init_database() == "existing_db"

    vector._client.list_databases.return_value = []
    vector._client.database.return_value = "created_db"
    vector._client.create_database.side_effect = None
    assert vector._init_database() == "created_db"

    vector._client.create_database.side_effect = baidu_module.ServerError(baidu_module.ServerErrCode.DB_ALREADY_EXIST)
    assert vector._init_database() == "created_db"


def test_table_existed_checks_table_access(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = MagicMock()
    vector._db.table.return_value = MagicMock()

    assert vector._table_existed() is True

    vector._db.table.side_effect = baidu_module.ServerError(baidu_module.ServerErrCode.TABLE_NOT_EXIST)
    assert vector._table_existed() is False

    vector._db.table.side_effect = baidu_module.ServerError(9999)
    with pytest.raises(baidu_module.ServerError):
        vector._table_existed()


def test_search_methods_delegate_to_database_table(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = MagicMock()
    vector._get_search_res = MagicMock(return_value=[Document(page_content="doc", metadata={"doc_id": "1"})])

    table = MagicMock()
    vector._db.table.return_value = table
    table.search.return_value = "vector_result"
    table.bm25_search.return_value = "bm25_result"

    result1 = vector.search_by_vector([0.1, 0.2], top_k=3, document_ids_filter=["doc-1"], score_threshold=0.2)
    result2 = vector.search_by_full_text("query", top_k=3, document_ids_filter=["doc-1"], score_threshold=0.2)

    assert result1 == vector._get_search_res.return_value
    assert result2 == vector._get_search_res.return_value
    assert vector._get_search_res.call_count == 2


def test_factory_initializes_collection_name_and_index_struct(baidu_module, monkeypatch):
    factory = baidu_module.BaiduVectorFactory()
    dataset = SimpleNamespace(id="dataset-1", index_struct_dict=None, index_struct=None)
    monkeypatch.setattr(baidu_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_ENDPOINT", "https://endpoint")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_CONNECTION_TIMEOUT_MS", 1000)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_ACCOUNT", "account")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_API_KEY", "key")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_DATABASE", "database")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_SHARD", 1)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_REPLICAS", 1)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_INVERTED_INDEX_ANALYZER", "DEFAULT_ANALYZER")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_INVERTED_INDEX_PARSER_MODE", "COARSE_MODE")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT", 500)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT_RATIO", 0.05)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_REBUILD_INDEX_TIMEOUT_IN_SECONDS", 300)

    with patch.object(baidu_module, "BaiduVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())

    assert result == "vector"
    assert vector_cls.call_args.kwargs["collection_name"] == "auto_collection"
    assert dataset.index_struct is not None


def test_init_get_type_to_index_struct_and_create_delegate(baidu_module, monkeypatch):
    init_client = MagicMock(return_value="client")
    init_database = MagicMock(return_value="database")
    monkeypatch.setattr(baidu_module.BaiduVector, "_init_client", init_client)
    monkeypatch.setattr(baidu_module.BaiduVector, "_init_database", init_database)

    config = baidu_module.BaiduConfig(
        endpoint="https://example.com",
        account="account",
        api_key="key",
        database="db",
    )
    vector = baidu_module.BaiduVector(collection_name="my_collection", config=config)

    assert vector.get_type() == baidu_module.VectorType.BAIDU
    assert vector.to_index_struct()["vector_store"]["class_prefix"] == "my_collection"
    assert vector._client == "client"
    assert vector._db == "database"

    vector._create_table = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="p1", metadata={"doc_id": "d1"})]
    vector.create(docs, [[0.1, 0.2]])
    vector._create_table.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_add_texts_batches_rows(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    table = MagicMock()
    vector._db = MagicMock()
    vector._db.table.return_value = table

    docs = [
        Document(page_content="doc-1", metadata={"doc_id": "id-1", "document_id": "doc-1"}),
        Document(page_content="doc-2", metadata={"doc_id": "id-2", "document_id": "doc-2"}),
    ]
    vector.add_texts(docs, [[0.1, 0.2], [0.3, 0.4]])

    assert table.upsert.call_count == 1
    inserted_rows = table.upsert.call_args.kwargs["rows"]
    assert len(inserted_rows) == 2


def test_add_texts_batches_more_than_batch_size(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    table = MagicMock()
    vector._db = MagicMock()
    vector._db.table.return_value = table

    docs = [
        Document(page_content=f"doc-{idx}", metadata={"doc_id": f"id-{idx}", "document_id": f"doc-{idx}"})
        for idx in range(1001)
    ]
    embeddings = [[0.1, 0.2] for _ in range(1001)]

    vector.add_texts(docs, embeddings)

    assert table.upsert.call_count == 2
    assert len(table.upsert.call_args_list[0].kwargs["rows"]) == 1000
    assert len(table.upsert.call_args_list[1].kwargs["rows"]) == 1


def test_text_exists_returns_false_when_query_code_is_not_success(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    table = MagicMock()
    vector._db = MagicMock()
    vector._db.table.return_value = table

    table.query.return_value = SimpleNamespace(code=0)
    assert vector.text_exists("id-1") is True

    table.query.return_value = SimpleNamespace(code=1)
    assert vector.text_exists("id-1") is False

    table.query.return_value = None
    assert vector.text_exists("id-1") is False


def test_get_search_result_handles_invalid_metadata_json(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    response = SimpleNamespace(rows=[{"row": {"page_content": "doc1", "metadata": "{bad json"}, "score": 0.7}])

    docs = vector._get_search_res(response, score_threshold=0.1)

    assert len(docs) == 1
    assert docs[0].metadata["score"] == 0.7
    assert "document_id" not in docs[0].metadata


def test_init_client_constructs_configuration_and_client(baidu_module, monkeypatch):
    credentials = MagicMock(return_value="credentials")
    configuration = MagicMock(return_value="configuration")
    client_cls = MagicMock(return_value="client")
    monkeypatch.setattr(baidu_module, "BceCredentials", credentials)
    monkeypatch.setattr(baidu_module, "Configuration", configuration)
    monkeypatch.setattr(baidu_module, "MochowClient", client_cls)

    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    config = SimpleNamespace(account="account", api_key="key", endpoint="https://endpoint")

    client = vector._init_client(config)

    assert client == "client"
    credentials.assert_called_once_with("account", "key")
    configuration.assert_called_once_with(credentials="credentials", endpoint="https://endpoint")
    client_cls.assert_called_once_with("configuration")


def test_init_database_raises_for_unknown_create_database_error(baidu_module):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._client = MagicMock()
    vector._client_config = SimpleNamespace(database="my_db")
    vector._client.list_databases.return_value = []
    vector._client.create_database.side_effect = baidu_module.ServerError(9999)

    with pytest.raises(baidu_module.ServerError):
        vector._init_database()


def test_create_table_handles_cache_and_validation_paths(baidu_module, monkeypatch):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._client_config = SimpleNamespace(
        index_type="HNSW",
        metric_type="IP",
        inverted_index_analyzer="DEFAULT_ANALYZER",
        inverted_index_parser_mode="COARSE_MODE",
        auto_build_row_count_increment=500,
        auto_build_row_count_increment_ratio=0.05,
        rebuild_index_timeout_in_seconds=300,
        replicas=1,
        shard=1,
    )
    vector._db = MagicMock()
    table = MagicMock()
    table.state = baidu_module.TableState.NORMAL
    vector._db.describe_table.return_value = table
    vector._table_existed = MagicMock(return_value=False)
    vector.delete = MagicMock()

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(baidu_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(baidu_module.redis_client, "set", MagicMock())
    monkeypatch.setattr(baidu_module.time, "sleep", lambda _s: None)
    monkeypatch.setattr(vector, "_wait_for_index_ready", MagicMock())

    # Cached table skips all work.
    monkeypatch.setattr(baidu_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_table(3)
    vector._db.create_table.assert_not_called()

    # Existing table also skips creation.
    monkeypatch.setattr(baidu_module.redis_client, "get", MagicMock(return_value=None))
    vector._table_existed.return_value = True
    vector._create_table(3)
    vector._db.create_table.assert_not_called()

    # Create table when cache is empty and table does not exist.
    vector._table_existed.return_value = False
    vector._create_table(3)
    vector._db.create_table.assert_called_once()
    baidu_module.redis_client.set.assert_called_once_with("vector_indexing_collection_1", 1, ex=3600)
    table.rebuild_index.assert_called_once_with(vector.vector_index)
    vector._wait_for_index_ready.assert_called_once_with(table, 3600)


def test_create_table_raises_for_invalid_index_or_metric(baidu_module, monkeypatch):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = MagicMock()
    vector._table_existed = MagicMock(return_value=False)
    vector.delete = MagicMock()
    vector._client_config = SimpleNamespace(
        index_type="INVALID",
        metric_type="IP",
        inverted_index_analyzer="DEFAULT_ANALYZER",
        inverted_index_parser_mode="COARSE_MODE",
        auto_build_row_count_increment=500,
        auto_build_row_count_increment_ratio=0.05,
        rebuild_index_timeout_in_seconds=300,
        replicas=1,
        shard=1,
    )

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(baidu_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(baidu_module.redis_client, "get", MagicMock(return_value=None))

    with pytest.raises(ValueError, match="unsupported index_type"):
        vector._create_table(3)

    vector._client_config.index_type = "HNSW"
    vector._client_config.metric_type = "INVALID"
    with pytest.raises(ValueError, match="unsupported metric_type"):
        vector._create_table(3)


def test_create_table_raises_timeout_if_table_never_becomes_normal(baidu_module, monkeypatch):
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._client_config = SimpleNamespace(
        index_type="HNSW",
        metric_type="IP",
        inverted_index_analyzer="DEFAULT_ANALYZER",
        inverted_index_parser_mode="COARSE_MODE",
        auto_build_row_count_increment=500,
        auto_build_row_count_increment_ratio=0.05,
        rebuild_index_timeout_in_seconds=300,
        replicas=1,
        shard=1,
    )
    vector._db = MagicMock()
    vector._db.describe_table.return_value = SimpleNamespace(state="CREATING")
    vector._table_existed = MagicMock(return_value=False)
    vector.delete = MagicMock()

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(baidu_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(baidu_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(baidu_module.time, "sleep", lambda _s: None)
    monkeypatch.setattr(baidu_module.time, "time", MagicMock(side_effect=[0, 301]))

    with pytest.raises(TimeoutError, match="Table creation timeout"):
        vector._create_table(3)


def test_factory_uses_existing_collection_prefix_when_index_struct_exists(baidu_module, monkeypatch):
    factory = baidu_module.BaiduVectorFactory()
    dataset = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_ENDPOINT", "https://endpoint")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_CONNECTION_TIMEOUT_MS", 1000)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_ACCOUNT", "account")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_API_KEY", "key")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_DATABASE", "database")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_SHARD", 1)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_REPLICAS", 1)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_INVERTED_INDEX_ANALYZER", "DEFAULT_ANALYZER")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_INVERTED_INDEX_PARSER_MODE", "COARSE_MODE")
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT", 500)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT_RATIO", 0.05)
    monkeypatch.setattr(baidu_module.dify_config, "BAIDU_VECTOR_DB_REBUILD_INDEX_TIMEOUT_IN_SECONDS", 300)

    with patch.object(baidu_module, "BaiduVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())

    assert result == "vector"
    assert vector_cls.call_args.kwargs["collection_name"] == "existing_collection"
