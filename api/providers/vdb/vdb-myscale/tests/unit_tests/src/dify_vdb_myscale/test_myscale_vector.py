import json
from dataclasses import dataclass
from typing import override

import dify_vdb_myscale.myscale_vector as myscale_module
import pytest
from dify_vdb_myscale.myscale_vector import MyScaleConfig, MyScaleVector, MyScaleVectorFactory, SortOrder

from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset


@dataclass(frozen=True)
class ClickHouseCall:
    """One ``command`` or ``query`` call: the SQL text and its bound parameters."""

    sql: str
    parameters: dict[str, object] | None = None


class QueryResult:
    """The parts of ``clickhouse_connect``'s query result that the vector store reads."""

    def __init__(
        self, rows: list[tuple[str, ...]] | None = None, named_rows: list[dict[str, object]] | None = None
    ) -> None:
        self.result_rows = rows or []
        self.row_count = len(self.result_rows)
        self._named_rows = named_rows or []

    def named_results(self) -> list[dict[str, object]]:
        return self._named_rows


class FakeClickHouseClient:
    """Stands in for the ClickHouse client: records each command and query and answers queries with a preset result."""

    def __init__(self) -> None:
        self.connections: list[dict[str, object]] = []
        self.commands: list[ClickHouseCall] = []
        self.queries: list[ClickHouseCall] = []
        self.query_result = QueryResult()
        self.query_error: Exception | None = None

    def connect(self, **kwargs: object) -> "FakeClickHouseClient":
        self.connections.append(kwargs)
        return self

    def command(self, sql: str, parameters: dict[str, object] | None = None) -> None:
        self.commands.append(ClickHouseCall(sql, parameters))

    def query(self, sql: str, parameters: dict[str, object] | None = None) -> QueryResult:
        self.queries.append(ClickHouseCall(sql, parameters))
        if self.query_error:
            raise self.query_error
        return self.query_result


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


SET_OBJECT_TYPE = ClickHouseCall("SET allow_experimental_object_type=1")


def _config(fts_params: str = "") -> MyScaleConfig:
    return MyScaleConfig(
        host="localhost",
        port=8123,
        user="default",
        password="",
        database="dify",
        fts_params=fts_params,
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> FakeClickHouseClient:
    client = FakeClickHouseClient()
    monkeypatch.setattr(myscale_module, "get_client", client.connect)
    return client


@pytest.fixture
def vector(client: FakeClickHouseClient) -> MyScaleVector:
    vector = MyScaleVector("collection_1", _config())
    assert vector._client is client
    return vector


def test_escape_str_replaces_backslash_and_quote() -> None:
    escaped = MyScaleVector.escape_str(r"text\with'special")
    assert escaped == "text with special"


def test_search_raises_for_invalid_top_k(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector._search("distance(vector, [0.1, 0.2])", SortOrder.ASC, top_k=0)

    assert client.queries == []


def test_search_builds_where_clause_for_cosine_threshold(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    client.query_result = QueryResult(
        named_rows=[{"text": "doc-1", "vector": [0.1, 0.2], "metadata": {"doc_id": "seg-1"}}]
    )

    docs = vector._search("distance(vector, [0.1, 0.2])", SortOrder.ASC, top_k=1, score_threshold=0.2)

    assert len(docs) == 1
    assert "WHERE dist < 0.8" in client.queries[-1].sql


def test_delete_by_ids_short_circuits_on_empty_list(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    vector.delete_by_ids([])

    assert client.commands == [SET_OBJECT_TYPE]


def test_factory_initializes_lower_case_collection_name(monkeypatch: pytest.MonkeyPatch) -> None:
    factory = MyScaleVectorFactory()
    dataset_with_index = Dataset(
        id="dataset-1", index_struct=json.dumps({"vector_store": {"class_prefix": "EXISTING_COLLECTION"}})
    )
    dataset_without_index = Dataset(id="dataset-2")

    monkeypatch.setattr(myscale_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_HOST", "localhost")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_PORT", 8123)
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_USER", "default")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_PASSWORD", "")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_DATABASE", "dify")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_FTS_PARAMS", "")
    built: list[tuple[str, MyScaleConfig]] = []

    def build_vector(*, collection_name: str, config: MyScaleConfig) -> str:
        built.append((collection_name, config))
        return "vector"

    monkeypatch.setattr(myscale_module, "MyScaleVector", build_vector)
    result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=UnusedEmbeddings(), session=None)
    result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=UnusedEmbeddings(), session=None)

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert built == [("existing_collection", _config()), ("auto_collection", _config())]
    assert dataset_without_index.index_struct is not None


def test_init_and_get_type_set_expected_defaults(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    assert vector.get_type() == "myscale"
    assert vector._vec_order == SortOrder.ASC
    assert client.connections == [{"host": "localhost", "port": 8123, "username": "default", "password": ""}]
    assert client.commands == [SET_OBJECT_TYPE]


def test_create_calls_create_collection_and_add_texts(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    docs = [Document(page_content="hello", metadata={"doc_id": "seg-1"})]

    result = vector.create(docs, [[0.1, 0.2]])

    assert result == ["seg-1"]
    create_database, create_table, insert = client.commands[1:]
    assert create_database == ClickHouseCall("CREATE DATABASE IF NOT EXISTS dify")
    assert "CONSTRAINT cons_vec_len CHECK length(vector) = 2" in create_table.sql
    assert "INSERT INTO dify.collection_1" in insert.sql
    assert "'seg-1', 'hello', [0.1, 0.2]" in insert.sql


def test_create_collection_builds_expected_sql(client: FakeClickHouseClient) -> None:
    vector = MyScaleVector("collection_1", _config(fts_params="tokenizer=unicode"))

    vector._create_collection(3)

    assert client.commands[1] == ClickHouseCall("CREATE DATABASE IF NOT EXISTS dify")
    assert len(client.commands) == 3
    sql = client.commands[2].sql
    assert "CREATE TABLE IF NOT EXISTS dify.collection_1" in sql
    assert "CONSTRAINT cons_vec_len CHECK length(vector) = 3" in sql
    assert "INDEX text_idx text TYPE fts('tokenizer=unicode')" in sql


def test_add_texts_inserts_rows_and_returns_ids(
    vector: MyScaleVector, client: FakeClickHouseClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(myscale_module.uuid, "uuid4", lambda: "generated-uuid")
    docs = [
        Document(page_content=r"te'xt\1", metadata={"doc_id": "doc-a", "document_id": "d-1"}),
        Document(page_content="text-2", metadata={"document_id": "d-2"}),
        Document.model_construct(page_content="text-3", metadata=None),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2], [0.3]])

    assert ids == ["doc-a", "generated-uuid"]
    sql = client.commands[-1].sql
    assert "INSERT INTO dify.collection_1" in sql
    assert "te xt 1" in sql
    assert "text-3" not in sql


def test_text_exists_and_metadata_operations(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    assert vector.text_exists("missing") is False

    client.query_result = QueryResult(rows=[("id-1",)])
    assert vector.text_exists("id-1' OR '1'='1") is True
    text_exists_call = client.queries[-1]
    assert "id={id:String}" in text_exists_call.sql
    assert "id-1' OR '1'='1" not in text_exists_call.sql
    assert text_exists_call.parameters == {"id": "id-1' OR '1'='1"}

    client.query_result = QueryResult(rows=[("id-1",), ("id-2",)])
    assert vector.get_ids_by_metadata_field("document_id", "doc-1' OR '1'='1") == ["id-1", "id-2"]
    metadata_query_call = client.queries[-1]
    assert "metadata.document_id={value:String}" in metadata_query_call.sql
    assert "doc-1' OR '1'='1" not in metadata_query_call.sql
    assert metadata_query_call.parameters == {"value": "doc-1' OR '1'='1"}

    vector.delete_by_ids(["id-1", "id-2"])
    delete_ids_call = client.commands[-1]
    assert "id IN {ids:Array(String)}" in delete_ids_call.sql
    assert delete_ids_call.parameters == {"ids": ["id-1", "id-2"]}

    vector.delete_by_metadata_field("document_id", "doc-1' OR '1'='1")
    delete_metadata_call = client.commands[-1]
    assert "metadata.document_id={value:String}" in delete_metadata_call.sql
    assert "doc-1' OR '1'='1" not in delete_metadata_call.sql
    assert delete_metadata_call.parameters == {"value": "doc-1' OR '1'='1"}
    assert len(client.commands) == 3


def test_metadata_operations_reject_invalid_key(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    with pytest.raises(ValueError, match="metadata key must be a valid identifier"):
        vector.get_ids_by_metadata_field("document_id) OR 1=1 --", "doc-1")

    with pytest.raises(ValueError, match="metadata key must be a valid identifier"):
        vector.delete_by_metadata_field("document_id) OR 1=1 --", "doc-1")

    assert client.queries == []
    assert client.commands == [SET_OBJECT_TYPE]


def test_search_delegation_methods(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    client.query_result = QueryResult(named_rows=[{"text": "doc", "vector": [0.1], "metadata": {"doc_id": "1"}}])

    result_vector = vector.search_by_vector([0.1, 0.2], top_k=2)
    result_text = vector.search_by_full_text("hello", top_k=2)

    assert [doc.page_content for doc in result_vector] == ["doc"]
    assert [doc.page_content for doc in result_text] == ["doc"]
    vector_query, text_query = client.queries
    assert "distance(vector, [0.1, 0.2]) as dist" in vector_query.sql
    assert "ORDER BY dist ASC LIMIT 2" in vector_query.sql
    assert vector_query.parameters == {}
    assert "TextSearch('enable_nlq=false')(text, {query:String}) as dist" in text_query.sql
    assert "ORDER BY dist DESC LIMIT 2" in text_query.sql
    assert text_query.parameters == {"query": "hello"}


def test_search_by_full_text_uses_query_parameters(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    client.query_result = QueryResult(named_rows=[{"text": "doc", "vector": [0.1], "metadata": {"doc_id": "1"}}])
    payload = "x') AS dist FROM dify.collection_1 UNION ALL SELECT secret FROM users --"

    docs = vector.search_by_full_text(payload, top_k=2)

    assert len(docs) == 1
    sql = client.queries[-1].sql
    assert payload not in sql
    assert "TextSearch('enable_nlq=false')(text, {query:String})" in sql
    assert client.queries[-1].parameters == {"query": payload}


def test_search_with_document_filter_and_exception(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    client.query_result = QueryResult(named_rows=[{"text": "doc", "vector": [0.1], "metadata": {"doc_id": "1"}}])

    docs = vector._search(
        "distance(vector, [0.1])",
        SortOrder.ASC,
        top_k=2,
        document_ids_filter=["doc-1", "doc-2"],
    )
    assert len(docs) == 1
    sql = client.queries[-1].sql
    assert "WHERE metadata['document_id'] IN {document_ids_filter:Array(String)}" in sql
    assert client.queries[-1].parameters == {"document_ids_filter": ["doc-1", "doc-2"]}

    client.query_error = RuntimeError("boom")
    assert vector._search("distance(vector, [0.1])", SortOrder.ASC, top_k=1) == []


def test_delete_drops_table(vector: MyScaleVector, client: FakeClickHouseClient) -> None:
    vector.delete()

    assert client.commands == [SET_OBJECT_TYPE, ClickHouseCall("DROP TABLE IF EXISTS dify.collection_1")]
