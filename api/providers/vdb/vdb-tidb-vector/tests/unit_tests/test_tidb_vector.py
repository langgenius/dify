import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


@pytest.fixture
def tidb_module():
    import dify_vdb_tidb_vector.tidb_vector as module

    return importlib.reload(module)


def _config(tidb_module):
    return tidb_module.TiDBVectorConfig(
        host="localhost",
        port=4000,
        user="root",
        password="secret",
        database="dify",
        program_name="dify-app",
    )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config TIDB_VECTOR_HOST is required"),
        ("port", 0, "config TIDB_VECTOR_PORT is required"),
        ("user", "", "config TIDB_VECTOR_USER is required"),
        ("database", "", "config TIDB_VECTOR_DATABASE is required"),
        ("program_name", "", "config APPLICATION_NAME is required"),
    ],
)
def test_tidb_config_validation(tidb_module, field, value, message):
    values = _config(tidb_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        tidb_module.TiDBVectorConfig.model_validate(values)


def test_init_get_type_and_distance_func(tidb_module, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(tidb_module, "create_engine", MagicMock(return_value="engine"))

    vector = tidb_module.TiDBVector("collection_1", _config(tidb_module), distance_func="L2")

    assert vector.get_type() == tidb_module.VectorType.TIDB_VECTOR
    assert vector._url.startswith("mysql+pymysql://root:secret@localhost:4000/dify")
    assert vector._dimension == 1536
    assert vector._get_distance_func() == "VEC_L2_DISTANCE"

    vector._distance_func = "cosine"
    assert vector._get_distance_func() == "VEC_COSINE_DISTANCE"

    vector._distance_func = "other"
    assert vector._get_distance_func() == "VEC_COSINE_DISTANCE"


def test_table_builds_columns_with_tidb_vector_type(tidb_module, monkeypatch: pytest.MonkeyPatch):
    fake_tidb_vector = types.ModuleType("tidb_vector")
    fake_tidb_sqlalchemy = types.ModuleType("tidb_vector.sqlalchemy")

    class _VectorType:
        def __init__(self, dim):
            self.dim = dim

    fake_tidb_sqlalchemy.VectorType = _VectorType

    monkeypatch.setitem(sys.modules, "tidb_vector", fake_tidb_vector)
    monkeypatch.setitem(sys.modules, "tidb_vector.sqlalchemy", fake_tidb_sqlalchemy)
    monkeypatch.setattr(tidb_module, "create_engine", MagicMock(return_value=MagicMock()))
    monkeypatch.setattr(tidb_module, "Column", lambda *args, **kwargs: SimpleNamespace(args=args, kwargs=kwargs))
    monkeypatch.setattr(
        tidb_module,
        "Table",
        lambda name, _metadata, *columns, **_kwargs: SimpleNamespace(name=name, columns=columns),
    )

    vector = tidb_module.TiDBVector("collection_1", _config(tidb_module))
    table = vector._table(3)

    assert table.name == "collection_1"
    column_names = [column.args[0] for column in table.columns]
    assert tidb_module.Field.PRIMARY_KEY in column_names
    assert tidb_module.Field.VECTOR in column_names
    assert tidb_module.Field.TEXT_KEY in column_names


def test_create_calls_collection_and_add_texts(tidb_module):
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock()

    docs = [Document(page_content="a", metadata={"doc_id": "id-1"})]
    vector.create(docs, [[0.1, 0.2]])

    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])
    assert vector._dimension == 2


def test_create_collection_skips_when_cache_hit(tidb_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(tidb_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(tidb_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(tidb_module.redis_client, "set", MagicMock())

    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._engine = MagicMock()

    tidb_module.Session = MagicMock()

    vector._create_collection(3)

    tidb_module.Session.assert_not_called()
    tidb_module.redis_client.set.assert_not_called()


def test_create_collection_executes_create_sql_and_sets_cache(tidb_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(tidb_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(tidb_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(tidb_module.redis_client, "set", MagicMock())

    session = MagicMock()

    class _BeginCtx:
        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    mock_sm = MagicMock(begin=MagicMock(return_value=_BeginCtx()))
    monkeypatch.setattr(tidb_module, "sessionmaker", lambda **kwargs: mock_sm)

    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._engine = MagicMock()
    vector._distance_func = "l2"

    vector._create_collection(3)

    sql = str(session.execute.call_args.args[0])
    assert "VECTOR<FLOAT>(3)" in sql
    assert "VEC_L2_DISTANCE" in sql
    tidb_module.redis_client.set.assert_called_once()


def test_add_texts_batches_inserts_and_returns_ids(tidb_module, monkeypatch: pytest.MonkeyPatch):
    class _InsertStmt:
        def __init__(self, table):
            self.table = table

        def values(self, rows):
            return {"table": self.table, "rows": rows}

    monkeypatch.setattr(tidb_module, "insert", lambda table: _InsertStmt(table))

    conn = MagicMock()
    transaction = MagicMock()
    transaction.__enter__.return_value = None
    transaction.__exit__.return_value = None
    conn.begin.return_value = transaction

    connection_ctx = MagicMock()
    connection_ctx.__enter__.return_value = conn
    connection_ctx.__exit__.return_value = None

    engine = MagicMock()
    engine.connect.return_value = connection_ctx

    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._engine = engine
    vector._table = MagicMock(return_value="table")

    docs = [Document(page_content=f"text-{i}", metadata={"doc_id": f"id-{i}"}) for i in range(501)]
    embeddings = [[float(i)] for i in range(501)]

    ids = vector.add_texts(docs, embeddings)

    assert ids[0] == "id-0"
    assert len(ids) == 501
    assert conn.execute.call_count == 2


@pytest.fixture
def tidb_vector_with_session(tidb_module, monkeypatch: pytest.MonkeyPatch):
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._engine = MagicMock()
    session = MagicMock()

    class _SessionCtx:
        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(tidb_module, "Session", lambda _engine: _SessionCtx())
    return vector, session, tidb_module


# 1. search_by_full_text returns empty
def test_search_by_full_text_returns_empty(tidb_vector_with_session):
    vector, _, _ = tidb_vector_with_session
    assert vector.search_by_full_text("query") == []


# 2. text_exists returns True when ids found
def test_text_exists_returns_true_when_ids_found(tidb_vector_with_session):
    vector, _, _ = tidb_vector_with_session
    vector.get_ids_by_metadata_field = MagicMock(return_value=["id-1"])
    assert vector.text_exists("doc-1") is True


# 3. text_exists returns False when no ids
def test_text_exists_returns_false_when_no_ids(tidb_vector_with_session):
    vector, _, _ = tidb_vector_with_session
    vector.get_ids_by_metadata_field = MagicMock(return_value=None)
    assert vector.text_exists("doc-1") is False


# 4. delete_by_ids delegates to _delete_by_ids when ids found
def test_delete_by_ids_delegates_to_internal_delete(tidb_vector_with_session):
    vector, session, tidb_module = tidb_vector_with_session
    session.execute.return_value.fetchall.return_value = [("id-a",), ("id-b",)]
    vector._delete_by_ids = MagicMock()
    # Use real get_ids_by_metadata_field
    vector.get_ids_by_metadata_field = tidb_module.TiDBVector.get_ids_by_metadata_field.__get__(
        vector, tidb_module.TiDBVector
    )
    vector.delete_by_ids(["doc-a", "doc-b"])
    vector._delete_by_ids.assert_called_once_with(["id-a", "id-b"])


# 5. delete_by_ids skips when no ids found
def test_delete_by_ids_skips_when_no_ids_found(tidb_vector_with_session):
    vector, session, tidb_module = tidb_vector_with_session
    session.execute.return_value.fetchall.return_value = []
    vector._delete_by_ids = MagicMock()
    # Use real get_ids_by_metadata_field
    vector.get_ids_by_metadata_field = tidb_module.TiDBVector.get_ids_by_metadata_field.__get__(
        vector, tidb_module.TiDBVector
    )
    vector.delete_by_ids(["doc-c"])
    vector._delete_by_ids.assert_not_called()


# 6. get_ids_by_metadata_field returns ids and returns None
def test_get_ids_by_metadata_field_returns_ids_and_returns_none(tidb_vector_with_session):
    vector, session, tidb_module = tidb_vector_with_session
    # Returns ids
    session.execute.return_value.fetchall.return_value = [("id-1",)]
    assert vector.get_ids_by_metadata_field("doc_id", "doc-1") == ["id-1"]
    # Returns None
    session.execute.return_value.fetchall.return_value = []
    assert vector.get_ids_by_metadata_field("doc_id", "doc-1") is None


# 1. _delete_by_ids raises on None
def test__delete_by_ids_raises_on_none(tidb_module):
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    with pytest.raises(ValueError, match="No ids provided"):
        vector._delete_by_ids(None)


# 2. _delete_by_ids returns True and calls execute
def test__delete_by_ids_returns_true_and_calls_execute(tidb_module):
    class _IDColumn:
        def in_(self, ids):
            return ids

    class _Delete:
        def where(self, condition):
            return condition

    table = SimpleNamespace(c=SimpleNamespace(id=_IDColumn()), delete=lambda: _Delete())
    conn = MagicMock()
    tx = MagicMock()
    tx.__enter__.return_value = None
    tx.__exit__.return_value = None
    conn.begin.return_value = tx
    conn_ctx = MagicMock()
    conn_ctx.__enter__.return_value = conn
    conn_ctx.__exit__.return_value = None
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._dimension = 2
    vector._engine = SimpleNamespace(connect=MagicMock(return_value=conn_ctx))
    vector._table = MagicMock(return_value=table)
    assert vector._delete_by_ids(["id-1"]) is True
    conn.execute.assert_called_once()


# 3. _delete_by_ids returns False on RuntimeError
def test__delete_by_ids_returns_false_on_runtime_error(tidb_module):
    class _IDColumn:
        def in_(self, ids):
            return ids

    class _Delete:
        def where(self, condition):
            return condition

    table = SimpleNamespace(c=SimpleNamespace(id=_IDColumn()), delete=lambda: _Delete())
    conn = MagicMock()
    tx = MagicMock()
    tx.__enter__.return_value = None
    tx.__exit__.return_value = None
    conn.begin.return_value = tx
    conn_ctx = MagicMock()
    conn_ctx.__enter__.return_value = conn
    conn_ctx.__exit__.return_value = None
    conn.execute.side_effect = RuntimeError("delete failed")
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._dimension = 2
    vector._engine = SimpleNamespace(connect=MagicMock(return_value=conn_ctx))
    vector._table = MagicMock(return_value=table)
    assert vector._delete_by_ids(["id-2"]) is False


# 4. delete_by_metadata_field calls _delete_by_ids when ids found
def test_delete_by_metadata_field_calls__delete_by_ids_when_ids_found(tidb_module):
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector.get_ids_by_metadata_field = MagicMock(return_value=["id-3"])
    vector._delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("doc_id", "doc-3")
    vector._delete_by_ids.assert_called_once_with(["id-3"])


# 5. delete_by_metadata_field does nothing when no ids
def test_delete_by_metadata_field_does_nothing_when_no_ids(tidb_module):
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector.get_ids_by_metadata_field = MagicMock(return_value=[])
    vector._delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("doc_id", "doc-4")
    vector._delete_by_ids.assert_not_called()


# Test search_by_vector filters and scores
def test_search_by_vector_filters_and_scores(tidb_module, monkeypatch: pytest.MonkeyPatch):
    session = MagicMock()
    session.execute.return_value = [
        ('{"doc_id":"id-1","document_id":"d-1"}', "text-1", 0.2),
        ('{"doc_id":"id-2","document_id":"d-2"}', "text-2", 0.4),
    ]
    session.commit = MagicMock()

    class _SessionCtx:
        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(tidb_module, "Session", lambda _engine: _SessionCtx())
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._engine = MagicMock()
    vector._distance_func = "cosine"
    docs = vector.search_by_vector(
        [0.1, 0.2],
        top_k=2,
        score_threshold=0.5,
        document_ids_filter=["d-1", "d-2"],
    )
    assert len(docs) == 2
    assert docs[0].metadata["score"] == pytest.approx(0.8)
    assert docs[1].metadata["score"] == pytest.approx(0.6)
    sql = str(session.execute.call_args.args[0])
    params = session.execute.call_args.kwargs["params"]
    assert "meta->>'$.document_id' in ('d-1', 'd-2')" in sql
    assert params["distance"] == pytest.approx(0.5)
    assert params["top_k"] == 2
    session.commit.assert_not_called()


# Test delete drops table
def test_delete_drops_table(tidb_module, monkeypatch: pytest.MonkeyPatch):
    session = MagicMock()
    session.execute.return_value = None

    class _BeginCtx:
        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    mock_sm = MagicMock(begin=MagicMock(return_value=_BeginCtx()))
    monkeypatch.setattr(tidb_module, "sessionmaker", lambda **kwargs: mock_sm)
    vector = tidb_module.TiDBVector.__new__(tidb_module.TiDBVector)
    vector._collection_name = "collection_1"
    vector._engine = MagicMock()
    vector.delete()
    drop_sql = str(session.execute.call_args.args[0])
    assert "DROP TABLE IF EXISTS collection_1" in drop_sql


def test_tidb_factory_uses_existing_or_generated_collection(tidb_module, monkeypatch: pytest.MonkeyPatch):
    factory = tidb_module.TiDBVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(tidb_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(tidb_module.dify_config, "TIDB_VECTOR_HOST", "localhost")
    monkeypatch.setattr(tidb_module.dify_config, "TIDB_VECTOR_PORT", 4000)
    monkeypatch.setattr(tidb_module.dify_config, "TIDB_VECTOR_USER", "root")
    monkeypatch.setattr(tidb_module.dify_config, "TIDB_VECTOR_PASSWORD", "secret")
    monkeypatch.setattr(tidb_module.dify_config, "TIDB_VECTOR_DATABASE", "dify")
    monkeypatch.setattr(tidb_module.dify_config, "APPLICATION_NAME", "dify-app")

    with patch.object(tidb_module, "TiDBVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None
