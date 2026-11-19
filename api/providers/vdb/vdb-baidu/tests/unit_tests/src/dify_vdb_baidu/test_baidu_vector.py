import importlib
import json
import sys
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from types import ModuleType, SimpleNamespace
from typing import override

import pytest

from core.rag.datasource.vdb.vector_integration_test_support import FakeModule
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset


def _build_fake_pymochow_modules() -> dict[str, FakeModule]:
    pymochow = FakeModule("pymochow")
    pymochow.__path__ = []
    pymochow_auth = FakeModule("pymochow.auth")
    pymochow_auth.__path__ = []
    pymochow_credentials = FakeModule("pymochow.auth.bce_credentials")
    pymochow_configuration = FakeModule("pymochow.configuration")
    pymochow_exception = FakeModule("pymochow.exception")
    pymochow_model = FakeModule("pymochow.model")
    pymochow_model.__path__ = []
    pymochow_model_database = FakeModule("pymochow.model.database")
    pymochow_model_enum = FakeModule("pymochow.model.enum")
    pymochow_model_schema = FakeModule("pymochow.model.schema")
    pymochow_model_table = FakeModule("pymochow.model.table")

    class _SimpleObject:
        def __init__[**P](self, *args: P.args, **kwargs: P.kwargs) -> None:
            self.args = args
            for key, value in kwargs.items():
                setattr(self, key, value)

    class ServerError(Exception):
        def __init__(self, code: int) -> None:
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
def baidu_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    for name, module in _build_fake_pymochow_modules().items():
        monkeypatch.setitem(sys.modules, name, module)
    import dify_vdb_baidu.baidu_vector as module

    return importlib.reload(module)


@dataclass(frozen=True)
class IndexInfo:
    """The index description pymochow returns from ``describe_index``."""

    state: str


@dataclass(frozen=True)
class DatabaseInfo:
    """A database entry pymochow returns from ``list_databases``."""

    database_name: str


class FakeTable:
    """A pymochow table that records what the vector store sends to it."""

    def __init__(self, state: str = "NORMAL") -> None:
        self.state = state
        self.query_result: object = None
        self.upserted_rows: list[list[object]] = []
        self.delete_filters: list[str] = []
        self.rebuilt_indexes: list[str] = []
        self.described_indexes: list[str] = []

    def upsert(self, *, rows: list[object]) -> None:
        self.upserted_rows.append(rows)

    def query(self, *, primary_key: dict[str, str]) -> object:
        return self.query_result

    def delete(self, *, filter: str) -> None:
        self.delete_filters.append(filter)

    def search(self, *, anns: object, projections: list[str], retrieve_vector: bool) -> str:
        return "vector_result"

    def bm25_search(self, *, request: object, projections: list[str]) -> str:
        return "bm25_result"

    def rebuild_index(self, index_name: str) -> None:
        self.rebuilt_indexes.append(index_name)

    def describe_index(self, index_name: str) -> IndexInfo:
        self.described_indexes.append(index_name)
        return IndexInfo(state="NORMAL")


class FakeDatabase:
    """A pymochow database holding one table, which records the table-level calls it receives."""

    def __init__(self, table: FakeTable | None = None, *, table_error: Exception | None = None) -> None:
        self._table = table or FakeTable()
        self.table_error = table_error
        self.drop_error: Exception | None = None
        self.opened_tables: list[str] = []
        self.dropped_tables: list[str] = []
        self.created_tables: list[str] = []

    def table(self, table_name: str) -> FakeTable:
        self.opened_tables.append(table_name)
        if self.table_error:
            raise self.table_error
        return self._table

    def drop_table(self, *, table_name: str) -> None:
        self.dropped_tables.append(table_name)
        if self.drop_error:
            raise self.drop_error

    def create_table(
        self, *, table_name: str, replication: int, partition: object, schema: object, description: str
    ) -> None:
        self.created_tables.append(table_name)

    def describe_table(self, table_name: str) -> FakeTable:
        return self._table


class FakeClient:
    """A MochowClient that knows a fixed set of databases."""

    def __init__(self, database_names: list[str], *, create_error: Exception | None = None) -> None:
        self._database_names = database_names
        self._create_error = create_error
        self.created_databases: list[str] = []

    def list_databases(self) -> list[DatabaseInfo]:
        return [DatabaseInfo(database_name=name) for name in self._database_names]

    def create_database(self, *, database_name: str) -> None:
        self.created_databases.append(database_name)
        if self._create_error:
            raise self._create_error

    def database(self, database_name: str) -> str:
        return f"database:{database_name}"


class FakeRedis:
    """The parts of ``redis_client`` that table creation uses, returning one cached value for every key."""

    def __init__(self, cached: object = None) -> None:
        self.cached = cached
        self.lock_names: list[str] = []
        self.set_calls: list[tuple[str, object, int | None]] = []

    @contextmanager
    def lock(self, name: str, timeout: int) -> Generator[None]:
        self.lock_names.append(name)
        yield

    def get(self, key: str) -> object:
        return self.cached

    def set(self, key: str, value: object, ex: int | None = None) -> None:
        self.set_calls.append((key, value, ex))


class UnusedEmbeddings(Embeddings):
    """Embeddings the factory only passes on to the vector store."""

    @override
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    @override
    def embed_multimodal_documents(self, multimodel_documents: list[dict[str, object]]) -> list[list[float]]:
        raise NotImplementedError

    @override
    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError

    @override
    def embed_multimodal_query(self, multimodel_document: dict[str, object]) -> list[float]:
        raise NotImplementedError


def test_baidu_config_validation(baidu_module: ModuleType) -> None:
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


def test_get_search_result_handles_metadata_and_threshold(baidu_module: ModuleType) -> None:
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


def test_delete_by_ids_and_delete_by_metadata_field(baidu_module: ModuleType) -> None:
    table = FakeTable()
    db = FakeDatabase(table)
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._db = db
    vector._collection_name = "collection_1"

    vector.delete_by_ids([])
    assert db.opened_tables == []

    vector.delete_by_ids(["id1", "id2"])
    vector.delete_by_metadata_field("source", 'abc"def')

    assert table.delete_filters == ["id IN('id1', 'id2')", 'metadata["source"] = "abc\\"def"']
    assert db.opened_tables == ["collection_1", "collection_1"]


def test_delete_handles_table_not_exist_error_and_raises_for_other_codes(baidu_module: ModuleType) -> None:
    db = FakeDatabase()
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = db

    db.drop_error = baidu_module.ServerError(baidu_module.ServerErrCode.TABLE_NOT_EXIST)
    vector.delete()
    assert db.dropped_tables == ["collection_1"]

    db.drop_error = baidu_module.ServerError(9999)
    with pytest.raises(baidu_module.ServerError):
        vector.delete()


def test_init_database_uses_existing_or_creates_when_missing(baidu_module: ModuleType) -> None:
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._client_config = SimpleNamespace(database="my_db")

    existing = FakeClient(["my_db"])
    vector._client = existing
    assert vector._init_database() == "database:my_db"
    assert existing.created_databases == []

    missing = FakeClient([])
    vector._client = missing
    assert vector._init_database() == "database:my_db"
    assert missing.created_databases == ["my_db"]

    vector._client = FakeClient([], create_error=baidu_module.ServerError(baidu_module.ServerErrCode.DB_ALREADY_EXIST))
    assert vector._init_database() == "database:my_db"


def test_table_existed_checks_table_access(baidu_module: ModuleType) -> None:
    db = FakeDatabase()
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = db

    assert vector._table_existed() is True

    db.table_error = baidu_module.ServerError(baidu_module.ServerErrCode.TABLE_NOT_EXIST)
    assert vector._table_existed() is False

    db.table_error = baidu_module.ServerError(9999)
    with pytest.raises(baidu_module.ServerError):
        vector._table_existed()


def test_search_methods_delegate_to_database_table(baidu_module: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = FakeDatabase()
    documents = [Document(page_content="doc", metadata={"doc_id": "1"})]
    parsed: list[tuple[object, float]] = []

    def get_search_res(res: object, score_threshold: float) -> list[Document]:
        parsed.append((res, score_threshold))
        return documents

    monkeypatch.setattr(vector, "_get_search_res", get_search_res)

    result1 = vector.search_by_vector([0.1, 0.2], top_k=3, document_ids_filter=["doc-1"], score_threshold=0.2)
    result2 = vector.search_by_full_text("query", top_k=3, document_ids_filter=["doc-1"], score_threshold=0.2)

    assert result1 == documents
    assert result2 == documents
    assert parsed == [("vector_result", 0.2), ("bm25_result", 0.2)]


def test_factory_initializes_collection_name_and_index_struct(
    baidu_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory = baidu_module.BaiduVectorFactory()
    dataset = Dataset(id="dataset-1")
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
    vector_kwargs: list[dict[str, object]] = []

    def build_vector(**kwargs: object) -> str:
        vector_kwargs.append(kwargs)
        return "vector"

    monkeypatch.setattr(baidu_module, "BaiduVector", build_vector)
    result = factory.init_vector(dataset, attributes=[], embeddings=UnusedEmbeddings(), session=None)

    assert result == "vector"
    assert [kwargs["collection_name"] for kwargs in vector_kwargs] == ["auto_collection"]
    assert dataset.index_struct is not None


def test_init_get_type_to_index_struct_and_create_delegate(
    baidu_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(baidu_module.BaiduVector, "_init_client", lambda _self, _config: "client")
    monkeypatch.setattr(baidu_module.BaiduVector, "_init_database", lambda _self: "database")

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

    calls: list[tuple[str, object]] = []
    monkeypatch.setattr(vector, "_create_table", lambda dimension: calls.append(("create_table", dimension)))
    monkeypatch.setattr(vector, "add_texts", lambda texts, embeddings: calls.append(("add_texts", (texts, embeddings))))
    docs = [Document(page_content="p1", metadata={"doc_id": "d1"})]
    vector.create(docs, [[0.1, 0.2]])
    assert calls == [("create_table", 2), ("add_texts", (docs, [[0.1, 0.2]]))]


def test_add_texts_batches_rows(baidu_module: ModuleType) -> None:
    table = FakeTable()
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = FakeDatabase(table)

    docs = [
        Document(page_content="doc-1", metadata={"doc_id": "id-1", "document_id": "doc-1"}),
        Document(page_content="doc-2", metadata={"doc_id": "id-2", "document_id": "doc-2"}),
    ]
    vector.add_texts(docs, [[0.1, 0.2], [0.3, 0.4]])

    assert [len(rows) for rows in table.upserted_rows] == [2]


def test_add_texts_batches_more_than_batch_size(baidu_module: ModuleType) -> None:
    table = FakeTable()
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = FakeDatabase(table)

    docs = [
        Document(page_content=f"doc-{idx}", metadata={"doc_id": f"id-{idx}", "document_id": f"doc-{idx}"})
        for idx in range(1001)
    ]
    embeddings = [[0.1, 0.2] for _ in range(1001)]

    vector.add_texts(docs, embeddings)

    assert [len(rows) for rows in table.upserted_rows] == [1000, 1]


def test_text_exists_returns_false_when_query_code_is_not_success(baidu_module: ModuleType) -> None:
    table = FakeTable()
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = FakeDatabase(table)

    table.query_result = SimpleNamespace(code=0)
    assert vector.text_exists("id-1") is True

    table.query_result = SimpleNamespace(code=1)
    assert vector.text_exists("id-1") is False

    table.query_result = None
    assert vector.text_exists("id-1") is False


def test_get_search_result_handles_invalid_metadata_json(baidu_module: ModuleType) -> None:
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    response = SimpleNamespace(rows=[{"row": {"page_content": "doc1", "metadata": "{bad json"}, "score": 0.7}])

    docs = vector._get_search_res(response, score_threshold=0.1)

    assert len(docs) == 1
    assert docs[0].metadata["score"] == 0.7
    assert "document_id" not in docs[0].metadata


def test_init_client_constructs_configuration_and_client(baidu_module: ModuleType) -> None:
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    config = SimpleNamespace(
        account="account",
        api_key="key",
        endpoint="https://endpoint",
        connection_timeout_in_mills=12_345,
    )

    client = vector._init_client(config)

    # The fake SDK classes keep their constructor arguments, so the client exposes the whole chain.
    (configuration,) = client.args
    assert configuration.credentials.args == ("account", "key")
    assert configuration.endpoint == "https://endpoint"
    assert configuration.connection_timeout_in_mills == 12_345


def test_init_database_raises_for_unknown_create_database_error(baidu_module: ModuleType) -> None:
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._client = FakeClient([], create_error=baidu_module.ServerError(9999))
    vector._client_config = SimpleNamespace(database="my_db")

    with pytest.raises(baidu_module.ServerError):
        vector._init_database()


def test_create_table_handles_cache_and_validation_paths(
    baidu_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
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
    table = FakeTable()
    db = FakeDatabase(table)
    vector._db = db
    fake_redis = FakeRedis(cached=1)
    monkeypatch.setattr(baidu_module, "redis_client", fake_redis)
    monkeypatch.setattr(baidu_module.time, "sleep", lambda _s: None)

    # Cached table skips all work.
    vector._create_table(3)
    assert db.opened_tables == []

    # Existing table also skips creation.
    fake_redis.cached = None
    vector._create_table(3)
    assert db.opened_tables == ["collection_1"]
    assert db.created_tables == []

    # Create table when cache is empty and table does not exist.
    db.table_error = baidu_module.ServerError(baidu_module.ServerErrCode.TABLE_NOT_EXIST)
    vector._create_table(3)
    assert db.dropped_tables == ["collection_1"]
    assert db.created_tables == ["collection_1"]
    assert fake_redis.set_calls == [("vector_indexing_collection_1", 1, 3600)]
    assert table.rebuilt_indexes == [vector.vector_index]
    assert table.described_indexes == [vector.vector_index]
    assert fake_redis.lock_names == ["vector_indexing_lock_collection_1"] * 3


def test_create_table_raises_for_invalid_index_or_metric(
    baidu_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    vector = baidu_module.BaiduVector.__new__(baidu_module.BaiduVector)
    vector._collection_name = "collection_1"
    vector._db = FakeDatabase(table_error=baidu_module.ServerError(baidu_module.ServerErrCode.TABLE_NOT_EXIST))
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
    monkeypatch.setattr(baidu_module, "redis_client", FakeRedis())

    with pytest.raises(ValueError, match="unsupported index_type"):
        vector._create_table(3)

    vector._client_config.index_type = "HNSW"
    vector._client_config.metric_type = "INVALID"
    with pytest.raises(ValueError, match="unsupported metric_type"):
        vector._create_table(3)


def test_create_table_raises_timeout_if_table_never_becomes_normal(
    baidu_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
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
    vector._db = FakeDatabase(
        FakeTable(state="CREATING"),
        table_error=baidu_module.ServerError(baidu_module.ServerErrCode.TABLE_NOT_EXIST),
    )
    monkeypatch.setattr(baidu_module, "redis_client", FakeRedis())
    monkeypatch.setattr(baidu_module.time, "sleep", lambda _s: None)
    monkeypatch.setattr(baidu_module.time, "time", iter([0, 301]).__next__)

    with pytest.raises(TimeoutError, match="Table creation timeout"):
        vector._create_table(3)


def test_factory_uses_existing_collection_prefix_when_index_struct_exists(
    baidu_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory = baidu_module.BaiduVectorFactory()
    dataset = Dataset(
        id="dataset-1", index_struct=json.dumps({"vector_store": {"class_prefix": "EXISTING_COLLECTION"}})
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
    vector_kwargs: list[dict[str, object]] = []

    def build_vector(**kwargs: object) -> str:
        vector_kwargs.append(kwargs)
        return "vector"

    monkeypatch.setattr(baidu_module, "BaiduVector", build_vector)
    result = factory.init_vector(dataset, attributes=[], embeddings=UnusedEmbeddings(), session=None)

    assert result == "vector"
    assert [kwargs["collection_name"] for kwargs in vector_kwargs] == ["existing_collection"]
