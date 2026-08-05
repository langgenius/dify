import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy.types import UserDefinedType

from core.rag.models.document import Document


def _build_fake_relyt_modules():
    pgvecto_rs = types.ModuleType("pgvecto_rs")
    pgvecto_rs_sqlalchemy = types.ModuleType("pgvecto_rs.sqlalchemy")

    class VECTOR(UserDefinedType):
        def __init__(self, dim):
            self.dim = dim

    pgvecto_rs_sqlalchemy.VECTOR = VECTOR
    return {
        "pgvecto_rs": pgvecto_rs,
        "pgvecto_rs.sqlalchemy": pgvecto_rs_sqlalchemy,
    }


class _FakeSession:
    def __init__(self, execute_result=None):
        self.execute_result = execute_result or MagicMock(fetchall=lambda: [])
        self.execute = MagicMock(return_value=self.execute_result)
        self.commit = MagicMock()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None


class _FakeBeginContext:
    def __init__(self, session):
        self._session = session

    def __enter__(self):
        return self._session

    def __exit__(self, exc_type, exc, tb):
        return None


def _patch_both(monkeypatch, module, session):
    """Patch both Session and sessionmaker on the module."""
    monkeypatch.setattr(module, "Session", lambda _client: session)
    monkeypatch.setattr(
        module, "sessionmaker", lambda **kwargs: MagicMock(begin=MagicMock(return_value=_FakeBeginContext(session)))
    )


@pytest.fixture
def relyt_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_relyt_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_relyt.relyt_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "host": "localhost",
        "port": 5432,
        "user": "postgres",
        "password": "secret",
        "database": "relyt",
    }
    values.update(overrides)
    return module.RelytConfig.model_validate(values)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config RELYT_HOST is required"),
        ("port", 0, "config RELYT_PORT is required"),
        ("user", "", "config RELYT_USER is required"),
        ("password", "", "config RELYT_PASSWORD is required"),
        ("database", "", "config RELYT_DATABASE is required"),
    ],
)
def test_relyt_config_validation(relyt_module, field, value, message):
    values = _config(relyt_module).model_dump()
    values[field] = value
    with pytest.raises(ValidationError, match=message):
        relyt_module.RelytConfig.model_validate(values)


def test_init_get_type_and_create_delegate(relyt_module, monkeypatch: pytest.MonkeyPatch):
    engine = MagicMock()
    monkeypatch.setattr(relyt_module, "create_engine", MagicMock(return_value=engine))
    vector = relyt_module.RelytVector("collection_1", _config(relyt_module), group_id="group-1")
    vector.create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="hello", metadata={"doc_id": "seg-1"})]

    vector.create(docs, [[0.1, 0.2]])

    assert vector.get_type() == relyt_module.VectorType.RELYT
    assert vector._url == "postgresql+psycopg2://postgres:secret@localhost:5432/relyt"
    assert vector.embedding_dimension == 2
    vector.create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_create_collection_cache_and_sql_execution(relyt_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(relyt_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(relyt_module.redis_client, "set", MagicMock())

    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()

    monkeypatch.setattr(relyt_module.redis_client, "get", MagicMock(return_value=1))
    session = _FakeSession()
    _patch_both(monkeypatch, relyt_module, session)
    vector.create_collection(3)
    session.execute.assert_not_called()

    monkeypatch.setattr(relyt_module.redis_client, "get", MagicMock(return_value=None))
    session = _FakeSession()
    _patch_both(monkeypatch, relyt_module, session)
    vector.create_collection(3)
    executed_sql = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("DROP TABLE IF EXISTS" in sql for sql in executed_sql)
    assert any("CREATE TABLE IF NOT EXISTS" in sql for sql in executed_sql)
    assert any("CREATE INDEX" in sql for sql in executed_sql)
    relyt_module.redis_client.set.assert_called_once()


def test_add_texts_and_metadata_queries(relyt_module, monkeypatch: pytest.MonkeyPatch):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector._group_id = "group-1"
    vector.client = MagicMock()

    begin_ctx = MagicMock()
    begin_ctx.__enter__.return_value = None
    begin_ctx.__exit__.return_value = None
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = None
    conn.begin.return_value = begin_ctx
    vector.client.connect.return_value = conn

    monkeypatch.setattr(relyt_module.uuid, "uuid1", MagicMock(side_effect=["id-1", "id-2"]))
    docs = [
        Document(page_content="a", metadata={"doc_id": "d-1"}),
        Document(page_content="b", metadata={"doc_id": "d-2"}),
    ]
    ids = vector.add_texts(docs, [[0.1], [0.2]])

    assert ids == ["id-1", "id-2"]
    assert conn.execute.call_count >= 1
    first_insert_values = conn.execute.call_args.args[0].compile().params
    assert "group_id" in str(first_insert_values)

    session = _FakeSession(execute_result=MagicMock(fetchall=lambda: [("id-a",), ("id-b",)]))
    monkeypatch.setattr(relyt_module, "Session", lambda _client: session)
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") == ["id-a", "id-b"]

    session = _FakeSession(execute_result=MagicMock(fetchall=lambda: []))
    monkeypatch.setattr(relyt_module, "Session", lambda _client: session)
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") is None


# 1. delete_by_uuids: success and connect error
def test_delete_by_uuids_success_and_connect_error(relyt_module):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    with pytest.raises(ValueError, match="No ids provided"):
        vector.delete_by_uuids(None)
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = None
    begin_ctx = MagicMock()
    begin_ctx.__enter__.return_value = None
    begin_ctx.__exit__.return_value = None
    conn.begin.return_value = begin_ctx
    vector.client.connect.return_value = conn
    assert vector.delete_by_uuids(["id-1"]) is True
    vector.client.connect.side_effect = RuntimeError("boom")
    assert vector.delete_by_uuids(["id-1"]) is False


# 2. delete_by_metadata_field calls delete_by_uuids
def test_delete_by_metadata_field_calls_delete_by_uuids(relyt_module):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    vector.get_ids_by_metadata_field = MagicMock(return_value=["id-1"])
    vector.delete_by_uuids = MagicMock(return_value=True)
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete_by_uuids.assert_called_once_with(["id-1"])


# 3. delete_by_ids translates to uuids
def test_delete_by_ids_translates_to_uuids(relyt_module, monkeypatch: pytest.MonkeyPatch):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    session = _FakeSession(execute_result=MagicMock(fetchall=lambda: [("uuid-1",), ("uuid-2",)]))
    monkeypatch.setattr(relyt_module, "Session", lambda _client: session)
    vector.delete_by_uuids = MagicMock(return_value=True)
    vector.delete_by_ids(["doc-1", "doc-2"])
    vector.delete_by_uuids.assert_called_once_with(["uuid-1", "uuid-2"])


# 4. text_exists True
def test_text_exists_true(relyt_module, monkeypatch: pytest.MonkeyPatch):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    session = _FakeSession(execute_result=MagicMock(fetchall=lambda: [("id-1",)]))
    monkeypatch.setattr(relyt_module, "Session", lambda _client: session)
    assert vector.text_exists("doc-1") is True


# 5. text_exists False
def test_text_exists_false(relyt_module, monkeypatch: pytest.MonkeyPatch):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    session = _FakeSession(execute_result=MagicMock(fetchall=lambda: []))
    monkeypatch.setattr(relyt_module, "Session", lambda _client: session)
    assert vector.text_exists("doc-1") is False


# 6. similarity_search_with_score_by_vector returns Documents and scores
def test_similarity_search_with_score_by_vector(relyt_module):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    result_rows = [
        SimpleNamespace(document="doc-a", metadata={"doc_id": "1"}, distance=0.1),
        SimpleNamespace(document="doc-b", metadata={"doc_id": "2"}, distance=0.8),
    ]
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = None
    conn.execute.return_value.fetchall.return_value = result_rows
    vector.client.connect.return_value = conn
    similarities = vector.similarity_search_with_score_by_vector([0.1, 0.2], k=2, filter={"document_id": ["d-1"]})
    assert len(similarities) == 2
    assert similarities[0][0].page_content == "doc-a"


# 7. search_by_vector filters by score and ids
def test_search_by_vector_filters_by_score_and_ids(relyt_module):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    vector.similarity_search_with_score_by_vector = MagicMock(
        return_value=[
            (Document(page_content="a", metadata={"doc_id": "1"}), 0.1),
            (Document(page_content="b", metadata={}), 0.9),
        ]
    )
    docs = vector.search_by_vector([0.1], top_k=2, score_threshold=0.5, document_ids_filter=["d-1"])
    assert len(docs) == 1
    assert vector.search_by_full_text("query") == []


# 8. delete commits session
def test_delete_drops_table(relyt_module, monkeypatch: pytest.MonkeyPatch):
    vector = relyt_module.RelytVector.__new__(relyt_module.RelytVector)
    vector._collection_name = "collection_1"
    vector.client = MagicMock()
    vector.embedding_dimension = 3
    session = _FakeSession()
    _patch_both(monkeypatch, relyt_module, session)
    vector.delete()
    session.execute.assert_called_once()


def test_relyt_factory_existing_and_generated_collection(relyt_module, monkeypatch: pytest.MonkeyPatch):
    factory = relyt_module.RelytVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(relyt_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(relyt_module.dify_config, "RELYT_HOST", "localhost")
    monkeypatch.setattr(relyt_module.dify_config, "RELYT_PORT", 5432)
    monkeypatch.setattr(relyt_module.dify_config, "RELYT_USER", "postgres")
    monkeypatch.setattr(relyt_module.dify_config, "RELYT_PASSWORD", "secret")
    monkeypatch.setattr(relyt_module.dify_config, "RELYT_DATABASE", "relyt")

    with patch.object(relyt_module, "RelytVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
