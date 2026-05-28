import importlib
import sys
import types
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_iris_module():
    iris = types.ModuleType("iris")

    def connect(**_kwargs):
        conn = MagicMock()
        conn.cursor.return_value = MagicMock()
        return conn

    iris.connect = MagicMock(side_effect=connect)
    return iris


@pytest.fixture
def iris_module(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setitem(sys.modules, "iris", _build_fake_iris_module())

    import dify_vdb_iris.iris_vector as module

    reloaded = importlib.reload(module)
    reloaded._pool_instance = None
    return reloaded


def _config(module, **overrides):
    values = {
        "IRIS_HOST": "localhost",
        "IRIS_SUPER_SERVER_PORT": 1972,
        "IRIS_USER": "user",
        "IRIS_PASSWORD": "pass",
        "IRIS_DATABASE": "db",
        "IRIS_SCHEMA": "schema",
        "IRIS_CONNECTION_URL": "url",
        "IRIS_MIN_CONNECTION": 1,
        "IRIS_MAX_CONNECTION": 2,
        "IRIS_TEXT_INDEX": True,
        "IRIS_TEXT_INDEX_LANGUAGE": "en",
    }
    values.update(overrides)
    return module.IrisVectorConfig.model_validate(values)


def test_get_iris_pool_singleton(iris_module):
    iris_module._pool_instance = None
    cfg = _config(iris_module)

    with patch.object(iris_module, "IrisConnectionPool", return_value="pool") as pool_cls:
        pool_1 = iris_module.get_iris_pool(cfg)
        pool_2 = iris_module.get_iris_pool(cfg)

    assert pool_1 == "pool"
    assert pool_2 == "pool"
    pool_cls.assert_called_once_with(cfg)


@pytest.fixture
def pool_with_min_max(iris_module):
    cfg = _config(iris_module, IRIS_MIN_CONNECTION=2, IRIS_MAX_CONNECTION=3)
    with patch.object(iris_module.IrisConnectionPool, "_create_connection", return_value=MagicMock()) as create_conn:
        pool = iris_module.IrisConnectionPool(cfg)
        yield pool, create_conn


def test_pool_initialization_respects_min_max(pool_with_min_max):
    pool, create_conn = pool_with_min_max
    assert len(pool._pool) == 2
    assert create_conn.call_count == 2


@pytest.fixture
def pool_for_get_connection(iris_module):
    cfg = _config(iris_module, IRIS_MIN_CONNECTION=2, IRIS_MAX_CONNECTION=3)
    pool = iris_module.IrisConnectionPool(cfg)
    return pool


def test_get_connection_returns_existing_and_increments(pool_for_get_connection):
    pool = pool_for_get_connection
    conn = MagicMock()
    pool._pool = [conn]
    pool._in_use = 0
    assert pool.get_connection() is conn
    assert pool._in_use == 1


def test_get_connection_creates_new_when_empty(pool_for_get_connection):
    pool = pool_for_get_connection
    pool._pool = []
    pool._in_use = 0
    pool._create_connection = MagicMock(return_value="new-conn")
    assert pool.get_connection() == "new-conn"


def test_get_connection_raises_when_exhausted(pool_for_get_connection):
    pool = pool_for_get_connection
    pool._pool = []
    pool._in_use = pool._max_size
    with pytest.raises(RuntimeError, match="exhausted"):
        pool.get_connection()


@pytest.fixture
def pool_for_return_connection(iris_module):
    cfg = _config(iris_module)
    with patch.object(iris_module.IrisConnectionPool, "_initialize_pool", return_value=None):
        pool = iris_module.IrisConnectionPool(cfg)
    return pool


def test_return_connection_adds_healthy(pool_for_return_connection):
    pool = pool_for_return_connection
    pool._in_use = 1
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor
    pool.return_connection(conn)
    assert pool._pool[-1] is conn
    assert pool._in_use == 0


def test_return_connection_replaces_bad(pool_for_return_connection):
    pool = pool_for_return_connection
    pool._in_use = 1
    bad_conn = MagicMock()
    bad_cursor = MagicMock()
    bad_cursor.execute.side_effect = OSError("bad")
    bad_conn.cursor.return_value = bad_cursor
    replacement = MagicMock()
    pool._create_connection = MagicMock(return_value=replacement)
    pool.return_connection(bad_conn)
    bad_conn.close.assert_called_once()
    assert pool._pool[-1] is replacement
    assert pool._in_use == 0


def test_return_connection_ignores_none(pool_for_return_connection):
    pool = pool_for_return_connection
    before = len(pool._pool)
    pool.return_connection(None)
    assert len(pool._pool) == before


@pytest.fixture
def pool_for_schema_and_close(iris_module):
    cfg = _config(iris_module)
    with patch.object(iris_module.IrisConnectionPool, "_initialize_pool", return_value=None):
        pool = iris_module.IrisConnectionPool(cfg)
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor
    pool._pool = [conn]
    return pool, conn, cursor


def test_ensure_schema_exists_cached_noop(pool_for_schema_and_close):
    pool, conn, cursor = pool_for_schema_and_close
    pool._schemas_initialized = {"cached_schema"}
    pool.ensure_schema_exists("cached_schema")
    cursor.execute.assert_not_called()


def test_ensure_schema_exists_creates_new(pool_for_schema_and_close):
    pool, conn, cursor = pool_for_schema_and_close
    pool._schemas_initialized = set()
    cursor.fetchone.return_value = (0,)
    pool.ensure_schema_exists("new_schema")
    assert "new_schema" in pool._schemas_initialized
    assert any("CREATE SCHEMA" in call.args[0] for call in cursor.execute.call_args_list)
    conn.commit.assert_called_once()


def test_ensure_schema_exists_existing_no_commit(pool_for_schema_and_close):
    pool, conn, cursor = pool_for_schema_and_close
    pool._schemas_initialized = set()
    cursor.fetchone.return_value = (1,)
    pool.ensure_schema_exists("existing_schema")
    conn.commit.assert_not_called()


def test_ensure_schema_exists_rollback_on_error(pool_for_schema_and_close):
    pool, conn, cursor = pool_for_schema_and_close
    pool._schemas_initialized = set()
    cursor.execute.side_effect = RuntimeError("schema failure")
    with pytest.raises(RuntimeError, match="schema failure"):
        pool.ensure_schema_exists("broken_schema")
    conn.rollback.assert_called()


def test_close_all_closes_and_resets(iris_module):
    cfg = _config(iris_module)
    with patch.object(iris_module.IrisConnectionPool, "_initialize_pool", return_value=None):
        pool = iris_module.IrisConnectionPool(cfg)
    conn = MagicMock()
    conn_2 = MagicMock()
    conn_2.close.side_effect = OSError("close fail")
    pool._pool = [conn, conn_2]
    pool._schemas_initialized = {"x"}
    pool.close_all()
    assert pool._pool == []
    assert pool._in_use == 0
    assert pool._schemas_initialized == set()


def test_iris_vector_init_get_cursor_and_create(iris_module):
    pool = MagicMock()
    pool.get_connection.return_value = MagicMock()

    with patch.object(iris_module, "get_iris_pool", return_value=pool):
        vector = iris_module.IrisVector("collection", _config(iris_module))

    assert vector.table_name == "EMBEDDING_COLLECTION"
    assert vector.schema == "schema"
    assert vector.get_type() == iris_module.VectorType.IRIS

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor
    vector.pool.get_connection.return_value = conn

    with vector._get_cursor() as got_cursor:
        assert got_cursor is cursor
    conn.commit.assert_called_once()
    vector.pool.return_connection.assert_called_with(conn)

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor
    vector.pool.get_connection.return_value = conn
    with pytest.raises(RuntimeError, match="boom"):
        with vector._get_cursor():
            raise RuntimeError("boom")
    conn.rollback.assert_called_once()

    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock(return_value=["id-1"])
    docs = [Document(page_content="a", metadata={"doc_id": "id-1"})]
    assert vector.create(docs, [[0.1, 0.2]]) == ["id-1"]
    vector._create_collection.assert_called_once_with(2)


def test_iris_vector_crud_and_vector_search(iris_module, monkeypatch: pytest.MonkeyPatch):
    with patch.object(iris_module, "get_iris_pool", return_value=MagicMock()):
        vector = iris_module.IrisVector("collection", _config(iris_module))

    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    monkeypatch.setattr(iris_module.uuid, "uuid4", lambda: "generated-id")

    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        SimpleNamespace(page_content="b", metadata=None),
    ]
    ids = vector.add_texts(docs, [[0.1], [0.2]])
    assert ids == ["id-1", "generated-id"]
    assert cursor.execute.call_count == 2

    cursor.fetchone.return_value = (1,)
    assert vector.text_exists("id-1") is True
    cursor.fetchone.return_value = None
    assert vector.text_exists("id-2") is False

    vector._get_cursor = MagicMock(side_effect=RuntimeError("db down"))
    assert vector.text_exists("id-3") is False

    vector._get_cursor = _cursor_ctx
    vector.delete_by_ids([])
    before = cursor.execute.call_count
    vector.delete_by_ids(["id-1", "id-2"])
    assert cursor.execute.call_count == before + 1

    vector.delete_by_metadata_field("document_id", "doc-1")
    assert "meta LIKE" in cursor.execute.call_args.args[0]

    cursor.fetchall.return_value = [
        ("id-1", "text-1", '{"document_id":"d-1"}', 0.9),
        ("id-2", "text-2", '{"document_id":"d-2"}', 0.2),
        ("id-x",),
    ]
    docs = vector.search_by_vector([0.1, 0.2], top_k=3, score_threshold=0.5)
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)


def test_iris_vector_full_text_search_paths(iris_module, monkeypatch: pytest.MonkeyPatch):
    cfg = _config(iris_module, IRIS_TEXT_INDEX=True)
    with patch.object(iris_module, "get_iris_pool", return_value=MagicMock()):
        vector = iris_module.IrisVector("collection", cfg)

    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    cursor.execute.side_effect = None
    cursor.fetchall.return_value = [
        ("id-1", "text-1", '{"document_id":"d-1"}', 0.7),
        ("id-2", "text-2", "{}", None),
    ]
    docs = vector.search_by_full_text("query", top_k=2, document_ids_filter=["d-1"])
    assert len(docs) == 2
    assert docs[0].metadata["score"] == pytest.approx(0.7)
    assert docs[1].metadata["score"] == pytest.approx(0.0)

    cursor.reset_mock()
    cursor.execute.side_effect = [RuntimeError("rank failed"), None]
    cursor.fetchall.return_value = [("id-3", "text-3", "{}", 0.5)]
    docs = vector.search_by_full_text("query", top_k=1)
    assert len(docs) == 1
    assert cursor.execute.call_count == 2

    cfg_like = _config(iris_module, IRIS_TEXT_INDEX=False)
    with patch.object(iris_module, "get_iris_pool", return_value=MagicMock()):
        vector_like = iris_module.IrisVector("collection", cfg_like)
    vector_like._get_cursor = _cursor_ctx

    fake_libs = types.ModuleType("libs")
    fake_helper = types.ModuleType("libs.helper")
    fake_helper.escape_like_pattern = lambda value: value.replace("%", "\\%")
    monkeypatch.setitem(sys.modules, "libs", fake_libs)
    monkeypatch.setitem(sys.modules, "libs.helper", fake_helper)

    cursor.reset_mock()
    cursor.execute.side_effect = None
    cursor.fetchall.return_value = []
    assert vector_like.search_by_full_text("100%", top_k=1) == []


def test_iris_vector_delete_create_collection_and_factory(iris_module, monkeypatch: pytest.MonkeyPatch):
    with patch.object(iris_module, "get_iris_pool", return_value=MagicMock()):
        vector = iris_module.IrisVector("collection", _config(iris_module, IRIS_TEXT_INDEX=True))

    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    vector.delete()
    assert "DROP TABLE" in cursor.execute.call_args.args[0]

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(iris_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(iris_module.redis_client, "set", MagicMock())

    monkeypatch.setattr(iris_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(2)
    cursor.execute.assert_called_once()

    cursor.reset_mock()
    monkeypatch.setattr(iris_module.redis_client, "get", MagicMock(return_value=None))
    vector.pool.ensure_schema_exists = MagicMock()
    vector._create_collection(3)
    assert cursor.execute.call_count == 3
    iris_module.redis_client.set.assert_called_once()

    cursor.reset_mock()
    vector.config.IRIS_TEXT_INDEX = False
    vector._create_collection(3)
    assert cursor.execute.call_count == 2

    factory = iris_module.IrisVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(iris_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(iris_module.dify_config, "IRIS_HOST", "localhost")
    monkeypatch.setattr(iris_module.dify_config, "IRIS_SUPER_SERVER_PORT", 1972)
    monkeypatch.setattr(iris_module.dify_config, "IRIS_USER", "user")
    monkeypatch.setattr(iris_module.dify_config, "IRIS_PASSWORD", "pass")
    monkeypatch.setattr(iris_module.dify_config, "IRIS_DATABASE", "db")
    monkeypatch.setattr(iris_module.dify_config, "IRIS_SCHEMA", "schema")
    monkeypatch.setattr(iris_module.dify_config, "IRIS_CONNECTION_URL", "url")
    monkeypatch.setattr(iris_module.dify_config, "IRIS_MIN_CONNECTION", 1)
    monkeypatch.setattr(iris_module.dify_config, "IRIS_MAX_CONNECTION", 2)
    monkeypatch.setattr(iris_module.dify_config, "IRIS_TEXT_INDEX", True)
    monkeypatch.setattr(iris_module.dify_config, "IRIS_TEXT_INDEX_LANGUAGE", "en")

    with patch.object(iris_module, "IrisVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
