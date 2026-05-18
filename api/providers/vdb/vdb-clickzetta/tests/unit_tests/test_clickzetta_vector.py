import importlib
import queue
import sys
import types
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_clickzetta_module():
    clickzetta = types.ModuleType("clickzetta")

    class _FakeCursor:
        def __init__(self):
            self.execute = MagicMock()
            self.executemany = MagicMock()
            self.fetchall = MagicMock(return_value=[])
            self.fetchone = MagicMock(return_value=(0,))

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class _FakeConnection:
        def __init__(self):
            self.cursor_obj = _FakeCursor()

        def cursor(self):
            return self.cursor_obj

        def close(self):
            return None

    def connect(**_kwargs):
        return _FakeConnection()

    clickzetta.connect = connect
    return clickzetta


@pytest.fixture
def clickzetta_module(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setitem(sys.modules, "clickzetta", _build_fake_clickzetta_module())
    import dify_vdb_clickzetta.clickzetta_vector as module

    return importlib.reload(module)


def _config(module):
    return module.ClickzettaConfig(
        username="username",
        password="password",
        instance="instance",
        service="service",
        workspace="workspace",
        vcluster="cluster",
        schema_name="dify",
    )


@pytest.mark.parametrize(
    ("field", "error_message"),
    [
        ("username", "CLICKZETTA_USERNAME"),
        ("password", "CLICKZETTA_PASSWORD"),
        ("instance", "CLICKZETTA_INSTANCE"),
        ("service", "CLICKZETTA_SERVICE"),
        ("workspace", "CLICKZETTA_WORKSPACE"),
        ("vcluster", "CLICKZETTA_VCLUSTER"),
        ("schema_name", "CLICKZETTA_SCHEMA"),
    ],
)
def test_clickzetta_config_validation(clickzetta_module, field, error_message):
    values = _config(clickzetta_module).model_dump()
    values[field] = ""
    with pytest.raises(ValueError, match=error_message):
        clickzetta_module.ClickzettaConfig.model_validate(values)


def test_parse_metadata_handles_valid_double_encoded_and_invalid_json(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)

    parsed = vector._parse_metadata('{"document_id":"doc-1"}', "row-1")
    assert parsed["doc_id"] == "row-1"
    assert parsed["document_id"] == "doc-1"

    parsed_double = vector._parse_metadata('"{\\"document_id\\": \\"doc-2\\"}"', "row-2")
    assert parsed_double["doc_id"] == "row-2"
    assert parsed_double["document_id"] == "doc-2"

    parsed_fallback = vector._parse_metadata("not-json", "row-3")
    assert parsed_fallback["doc_id"] == "row-3"
    assert parsed_fallback["document_id"] == "row-3"


def test_safe_doc_id_and_vector_format_helpers(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)

    assert vector._format_vector_simple([0.1, 0.2, 0.3]) == "0.1,0.2,0.3"
    assert vector._safe_doc_id("abc-123_DEF") == "abc-123_DEF"
    assert vector._safe_doc_id("ab c;\n") == "abc"
    assert len(vector._safe_doc_id("a" * 300)) == 255


def test_table_exists_returns_false_for_not_found_and_other_exceptions(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"

    @contextmanager
    def _ctx_not_found():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.execute.side_effect = RuntimeError("CZLH-42000 table or view not found")
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx_not_found
    assert vector._table_exists() is False

    @contextmanager
    def _ctx_other_error():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.execute.side_effect = RuntimeError("permission denied")
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx_other_error
    assert vector._table_exists() is False


def test_text_exists_handles_missing_table_and_existing_rows(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"

    vector._table_exists = MagicMock(return_value=False)
    assert vector.text_exists("doc-1") is False

    vector._table_exists = MagicMock(return_value=True)

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.fetchone.return_value = (1,)
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    assert vector.text_exists("doc-1") is True


def test_delete_by_ids_and_delete_by_metadata_field_short_circuit(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    vector._execute_write = MagicMock()

    vector.delete_by_ids([])
    vector._execute_write.assert_not_called()

    vector._table_exists = MagicMock(return_value=False)
    vector.delete_by_ids(["doc-1"])
    vector._execute_write.assert_not_called()

    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._execute_write.assert_not_called()


def test_search_short_circuit_behaviors(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"

    vector._table_exists = MagicMock(return_value=False)
    assert vector.search_by_vector([0.1, 0.2], top_k=2) == []

    vector._config.enable_inverted_index = False
    assert vector.search_by_full_text("query", top_k=2) == []


def test_search_by_like_returns_documents_with_default_score(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    vector._table_exists = MagicMock(return_value=True)
    vector._parse_metadata = MagicMock(return_value={"document_id": "doc-1", "doc_id": "seg-1"})

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.fetchall.return_value = [("seg-1", "content", '{"document_id":"doc-1"}')]
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    docs = vector._search_by_like("query", top_k=3, document_ids_filter=["doc-1"])

    assert len(docs) == 1
    assert docs[0].page_content == "content"
    assert docs[0].metadata["score"] == 0.5


def test_factory_initializes_clickzetta_vector(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    factory = clickzetta_module.ClickzettaVectorFactory()
    dataset = SimpleNamespace(id="dataset-1")

    monkeypatch.setattr(clickzetta_module.Dataset, "gen_collection_name_by_id", lambda _id: "COLLECTION")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_USERNAME", "username")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_PASSWORD", "password")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_INSTANCE", "instance")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_SERVICE", "service")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_WORKSPACE", "workspace")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_VCLUSTER", "cluster")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_SCHEMA", "dify")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_BATCH_SIZE", 10)
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_ENABLE_INVERTED_INDEX", True)
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_ANALYZER_TYPE", "chinese")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_ANALYZER_MODE", "smart")
    monkeypatch.setattr(clickzetta_module.dify_config, "CLICKZETTA_VECTOR_DISTANCE_FUNCTION", "cosine_distance")

    with patch.object(clickzetta_module, "ClickzettaVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())

    assert result == "vector"
    assert vector_cls.call_args.kwargs["collection_name"] == "collection"


def test_connection_pool_singleton_and_config_key(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    clickzetta_module.ClickzettaConnectionPool._instance = None
    monkeypatch.setattr(clickzetta_module.ClickzettaConnectionPool, "_start_cleanup_thread", MagicMock())

    pool_1 = clickzetta_module.ClickzettaConnectionPool.get_instance()
    pool_2 = clickzetta_module.ClickzettaConnectionPool.get_instance()
    key = pool_1._get_config_key(_config(clickzetta_module))

    assert pool_1 is pool_2
    assert "username:instance:service:workspace:cluster:dify" in key


def test_connection_pool_create_connection_retries_and_configures(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(clickzetta_module.ClickzettaConnectionPool, "_start_cleanup_thread", MagicMock())
    pool = clickzetta_module.ClickzettaConnectionPool()
    config = _config(clickzetta_module)
    connection = MagicMock()

    monkeypatch.setattr(clickzetta_module.time, "sleep", lambda _s: None)
    monkeypatch.setattr(
        clickzetta_module.clickzetta, "connect", MagicMock(side_effect=[RuntimeError("boom"), connection])
    )
    pool._configure_connection = MagicMock()

    created = pool._create_connection(config)

    assert created is connection
    assert clickzetta_module.clickzetta.connect.call_count == 2
    pool._configure_connection.assert_called_once_with(connection)


def test_connection_pool_create_connection_raises_after_retries(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(clickzetta_module.ClickzettaConnectionPool, "_start_cleanup_thread", MagicMock())
    pool = clickzetta_module.ClickzettaConnectionPool()
    config = _config(clickzetta_module)

    monkeypatch.setattr(clickzetta_module.time, "sleep", lambda _s: None)
    monkeypatch.setattr(clickzetta_module.clickzetta, "connect", MagicMock(side_effect=RuntimeError("boom")))

    with pytest.raises(RuntimeError, match="boom"):
        pool._create_connection(config)


def test_connection_pool_configure_and_validate_connection(clickzetta_module):
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(clickzetta_module.ClickzettaConnectionPool, "_start_cleanup_thread", MagicMock())
    pool = clickzetta_module.ClickzettaConnectionPool()

    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.__exit__.return_value = None
    connection = MagicMock()
    connection.cursor.return_value = cursor

    pool._configure_connection(connection)
    assert cursor.execute.call_count >= 2
    assert pool._is_connection_valid(connection) is True

    bad_connection = MagicMock()
    bad_connection.cursor.side_effect = RuntimeError("bad connection")
    assert pool._is_connection_valid(bad_connection) is False
    monkeypatch.undo()


def test_connection_pool_configure_connection_swallows_errors(clickzetta_module):
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(clickzetta_module.ClickzettaConnectionPool, "_start_cleanup_thread", MagicMock())
    pool = clickzetta_module.ClickzettaConnectionPool()
    connection = MagicMock()
    connection.cursor.side_effect = RuntimeError("cannot configure")

    pool._configure_connection(connection)
    monkeypatch.undo()


def test_connection_pool_get_return_cleanup_and_shutdown(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(clickzetta_module.ClickzettaConnectionPool, "_start_cleanup_thread", MagicMock())
    pool = clickzetta_module.ClickzettaConnectionPool()
    config = _config(clickzetta_module)
    key = pool._get_config_key(config)

    created_connection = MagicMock()
    pool._create_connection = MagicMock(return_value=created_connection)
    first = pool.get_connection(config)
    assert first is created_connection

    reusable_connection = MagicMock()
    pool._pools[key] = [(reusable_connection, clickzetta_module.time.time())]
    pool._is_connection_valid = MagicMock(return_value=True)
    reused = pool.get_connection(config)
    assert reused is reusable_connection

    expired_connection = MagicMock()
    pool._pools[key] = [(expired_connection, 0.0)]
    pool._is_connection_valid = MagicMock(return_value=False)
    monkeypatch.setattr(clickzetta_module.time, "time", MagicMock(return_value=1000.0))
    pool.get_connection(config)
    expired_connection.close.assert_called_once()

    random_connection = MagicMock()
    pool._is_connection_valid = MagicMock(return_value=True)
    pool.return_connection(config, random_connection)
    assert len(pool._pools[key]) == 1

    pool._pools[key] = [(MagicMock(), 0.0), (MagicMock(), 1000.0)]
    pool._connection_timeout = 10
    pool._cleanup_expired_connections()
    assert len(pool._pools[key]) == 1

    unknown_pool = MagicMock()
    pool.return_connection(_config(clickzetta_module).model_copy(update={"workspace": "other"}), unknown_pool)
    unknown_pool.close.assert_called_once()

    pool.shutdown()
    assert pool._shutdown is True


def test_connection_pool_start_cleanup_thread_runs_worker_once(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    pool = clickzetta_module.ClickzettaConnectionPool.__new__(clickzetta_module.ClickzettaConnectionPool)
    pool._shutdown = False
    pool._cleanup_expired_connections = MagicMock(side_effect=lambda: setattr(pool, "_shutdown", True))

    monkeypatch.setattr(clickzetta_module.time, "sleep", lambda _s: None)

    class _Thread:
        def __init__(self, target, daemon):
            self._target = target
            self.daemon = daemon
            self.started = False

        def start(self):
            self.started = True
            self._target()

    monkeypatch.setattr(clickzetta_module.threading, "Thread", _Thread)
    pool._start_cleanup_thread()

    assert pool._cleanup_thread.started is True
    pool._cleanup_expired_connections.assert_called_once()


def test_vector_init_connection_context_and_helpers(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    pool.get_connection.return_value = "conn"
    monkeypatch.setattr(clickzetta_module.ClickzettaConnectionPool, "get_instance", MagicMock(return_value=pool))
    monkeypatch.setattr(clickzetta_module.ClickzettaVector, "_init_write_queue", MagicMock())

    vector = clickzetta_module.ClickzettaVector("My-Collection", _config(clickzetta_module))
    assert vector._table_name == "my_collection"

    assert vector._get_connection() == "conn"
    vector._return_connection("conn")
    pool.return_connection.assert_called_with(vector._config, "conn")

    with vector.get_connection_context() as conn:
        assert conn == "conn"
    assert pool.return_connection.call_count >= 2

    assert vector.get_type() == "clickzetta"
    assert vector._ensure_connection() == "conn"


def test_write_queue_initialization_worker_and_execute_write(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    class _Thread:
        def __init__(self, target, daemon):
            self.target = target
            self.daemon = daemon
            self.started = 0

        def start(self):
            self.started += 1

    monkeypatch.setattr(clickzetta_module.threading, "Thread", _Thread)
    clickzetta_module.ClickzettaVector._write_queue = None
    clickzetta_module.ClickzettaVector._write_thread = None
    clickzetta_module.ClickzettaVector._shutdown = False
    clickzetta_module.ClickzettaVector._init_write_queue()
    clickzetta_module.ClickzettaVector._init_write_queue()
    assert clickzetta_module.ClickzettaVector._write_thread.started == 1

    result_queue_ok = queue.Queue()
    result_queue_fail = queue.Queue()
    clickzetta_module.ClickzettaVector._write_queue = queue.Queue()
    clickzetta_module.ClickzettaVector._shutdown = False
    clickzetta_module.ClickzettaVector._write_queue.put((lambda x: x + 1, (1,), {}, result_queue_ok))
    clickzetta_module.ClickzettaVector._write_queue.put(
        (lambda: (_ for _ in ()).throw(RuntimeError("worker error")), (), {}, result_queue_fail)
    )
    clickzetta_module.ClickzettaVector._write_queue.put(None)
    clickzetta_module.ClickzettaVector._write_worker()

    assert result_queue_ok.get() == (True, 2)
    failed = result_queue_fail.get()
    assert failed[0] is False
    assert isinstance(failed[1], RuntimeError)

    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    clickzetta_module.ClickzettaVector._write_queue = None
    with pytest.raises(RuntimeError, match="Write queue not initialized"):
        vector._execute_write(lambda: None)

    class _ImmediateSuccessQueue:
        def put(self, task):
            func, args, kwargs, result_q = task
            result_q.put((True, func(*args, **kwargs)))

    clickzetta_module.ClickzettaVector._write_queue = _ImmediateSuccessQueue()
    assert vector._execute_write(lambda x: x * 2, 3) == 6

    class _ImmediateFailQueue:
        def put(self, task):
            _, _, _, result_q = task
            result_q.put((False, ValueError("write failed")))

    clickzetta_module.ClickzettaVector._write_queue = _ImmediateFailQueue()
    with pytest.raises(ValueError, match="write failed"):
        vector._execute_write(lambda: None)


def test_table_exists_true_and_create_invokes_write_and_add_texts(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"

    @contextmanager
    def _ctx_exists():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx_exists
    assert vector._table_exists() is True

    vector._execute_write = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="content", metadata={"doc_id": "d1"})]
    vector.create(docs, [[0.1, 0.2]])
    vector._execute_write.assert_called_once()
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_create_table_and_indexes_paths(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    vector._create_vector_index = MagicMock()
    vector._create_inverted_index = MagicMock()

    vector._table_exists = MagicMock(return_value=True)
    vector._create_table_and_indexes([[0.1, 0.2]])
    vector._create_vector_index.assert_not_called()

    vector._table_exists = MagicMock(return_value=False)

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    vector._create_table_and_indexes([[0.1, 0.2, 0.3]])
    vector._create_vector_index.assert_called_once()
    vector._create_inverted_index.assert_called_once()

    vector._config.enable_inverted_index = False
    vector._create_vector_index.reset_mock()
    vector._create_inverted_index.reset_mock()
    vector._create_table_and_indexes([])
    vector._create_vector_index.assert_called_once()
    vector._create_inverted_index.assert_not_called()


def test_create_vector_index_branches(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    cursor = MagicMock()

    cursor.fetchall.return_value = [("idx_table_vector", "embedding_vector")]
    vector._create_vector_index(cursor)
    assert cursor.execute.call_count == 1

    cursor.reset_mock()
    cursor.execute.side_effect = [RuntimeError("show index failed"), None]
    vector._create_vector_index(cursor)
    assert cursor.execute.call_count == 2

    cursor.reset_mock()
    cursor.execute.side_effect = [None, RuntimeError("already exists")]
    cursor.fetchall.return_value = []
    vector._create_vector_index(cursor)

    cursor.reset_mock()
    cursor.execute.side_effect = [None, RuntimeError("unexpected")]
    cursor.fetchall.return_value = []
    with pytest.raises(RuntimeError, match="unexpected"):
        vector._create_vector_index(cursor)


def test_create_inverted_index_branches(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    cursor = MagicMock()

    cursor.fetchall.return_value = [("idx_table_1_text", "INVERTED", "page_content")]
    vector._create_inverted_index(cursor)
    assert cursor.execute.call_count == 1

    cursor.reset_mock()
    cursor.execute.side_effect = [RuntimeError("show failed"), None]
    vector._create_inverted_index(cursor)
    assert cursor.execute.call_count == 2

    cursor.reset_mock()
    cursor.execute.side_effect = [
        None,
        RuntimeError("already has index"),
        None,
    ]
    cursor.fetchall.return_value = [("idx_table_1_text", "INVERTED", "page_content")]
    vector._create_inverted_index(cursor)

    cursor.reset_mock()
    cursor.execute.side_effect = [None, RuntimeError("other create failure")]
    cursor.fetchall.return_value = []
    vector._create_inverted_index(cursor)


def test_add_texts_batches_and_insert_batch_behaviors(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._config.batch_size = 2
    vector._table_name = "table_1"
    vector._execute_write = MagicMock()
    vector._safe_doc_id = MagicMock(side_effect=lambda doc_id: str(doc_id))

    docs = [
        Document(page_content="doc-1", metadata={"doc_id": "id-1"}),
        Document(page_content="doc-2", metadata={"doc_id": "id-2"}),
        Document(page_content="doc-3", metadata={"doc_id": "id-3"}),
    ]
    vectors = [[0.1], [0.2], [0.3]]

    vector.add_texts([], [])
    vector._execute_write.assert_not_called()

    added_ids = vector.add_texts(docs, vectors)
    assert added_ids == ["id-1", "id-2", "id-3"]
    assert vector._execute_write.call_count == 2
    assert vector._execute_write.call_args_list[0].args == (
        vector._insert_batch,
        docs[:2],
        vectors[:2],
        ["id-1", "id-2"],
        0,
        2,
        2,
    )
    assert vector._execute_write.call_args_list[1].args == (
        vector._insert_batch,
        docs[2:],
        vectors[2:],
        ["id-3"],
        2,
        2,
        2,
    )

    vector._insert_batch([], [], [], 0, 2, 1)
    vector._insert_batch(docs[:1], vectors, ["id-1"], 0, 2, 1)

    bad_doc = Document(page_content="doc-bad", metadata={"doc_id": "id-bad", "bad": {1}})
    good_doc = Document(page_content="doc-good", metadata={"doc_id": "id-good"})

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    vector._insert_batch(
        [bad_doc, good_doc],
        [[0.1, 0.2], [0.3, 0.4]],
        ["id-bad", "id-good"],
        0,
        2,
        1,
    )

    @contextmanager
    def _ctx_error():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.executemany.side_effect = RuntimeError("insert failed")
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx_error
    with pytest.raises(RuntimeError, match="insert failed"):
        vector._insert_batch([good_doc], [[0.1, 0.2]], ["id-good"], 0, 1, 1)

    monkeypatch.setattr(clickzetta_module.uuid, "uuid4", lambda: "generated-id")
    vector._safe_doc_id = clickzetta_module.ClickzettaVector._safe_doc_id.__get__(vector)
    assert vector._safe_doc_id("") == "generated-id"
    assert vector._safe_doc_id("!!!") == "generated-id"


def test_delete_by_ids_and_metadata_impl_paths(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    vector._execute_write = MagicMock()
    vector._table_exists = MagicMock(return_value=True)

    vector.delete_by_ids(["id-1", "id-2"])
    vector._execute_write.assert_called_once()
    assert vector._execute_write.call_args.args[0] == vector._delete_by_ids_impl

    vector._execute_write.reset_mock()
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._execute_write.assert_called_once()
    assert vector._execute_write.call_args.args[0] == vector._delete_by_metadata_field_impl

    vector._safe_doc_id = MagicMock(side_effect=lambda x: x)

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    vector._delete_by_ids_impl(["id-1", "id-2"])
    vector._delete_by_metadata_field_impl("document_id", "doc-1")


def test_search_by_vector_covers_cosine_and_l2_paths(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._config.vector_distance_function = "cosine_distance"
    vector._table_name = "table_1"
    vector._table_exists = MagicMock(return_value=True)
    vector._parse_metadata = MagicMock(return_value={"document_id": "doc-1", "doc_id": "seg-1"})

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.fetchall.return_value = [("seg-1", "content", '{"document_id":"doc-1"}', 0.2)]
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    cosine_docs = vector.search_by_vector(
        [0.1, 0.2], top_k=3, score_threshold=0.5, document_ids_filter=["doc-1"], filter={"k": "v"}
    )
    assert cosine_docs[0].metadata["score"] == pytest.approx(0.9)

    vector._config.vector_distance_function = "l2_distance"
    l2_docs = vector.search_by_vector([0.1, 0.2], top_k=3, score_threshold=0.5)
    assert l2_docs[0].metadata["score"] == pytest.approx(1 / 1.2)


def test_search_by_full_text_success_and_fallback(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    vector._table_exists = MagicMock(return_value=True)

    @contextmanager
    def _ctx_success():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.fetchall.return_value = [
            ("seg-1", "content-1", '"{\\"document_id\\":\\"doc-1\\"}"'),
            ("seg-2", "content-2", "invalid-json"),
        ]
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx_success
    docs = vector.search_by_full_text("search'value", top_k=2, document_ids_filter=["doc-1"], filter={"a": 1})
    assert len(docs) == 2
    assert docs[0].metadata["score"] == 1.0
    assert docs[1].metadata["doc_id"] == "seg-2"

    @contextmanager
    def _ctx_failure():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.execute.side_effect = RuntimeError("full text failed")
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx_failure
    vector._search_by_like = MagicMock(return_value=[Document(page_content="fallback", metadata={"score": 0.5})])
    fallback_docs = vector.search_by_full_text("query", top_k=1)
    assert fallback_docs == vector._search_by_like.return_value


def test_search_by_like_missing_table_and_delete_table(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    vector._table_exists = MagicMock(return_value=False)
    assert vector._search_by_like("query", top_k=1) == []

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    vector.delete()


def test_clickzetta_pool_cleanup_and_shutdown_edge_paths(clickzetta_module):
    pool = clickzetta_module.ClickzettaConnectionPool.__new__(clickzetta_module.ClickzettaConnectionPool)
    pool._pools = {}
    pool._pool_locks = {}
    pool._max_pool_size = 1
    pool._connection_timeout = 10
    pool._lock = clickzetta_module.threading.Lock()
    pool._shutdown = False

    config = _config(clickzetta_module)
    key = pool._get_config_key(config)
    pool._pools[key] = [(MagicMock(), 1.0)]
    pool._pool_locks[key] = clickzetta_module.threading.Lock()
    pool._is_connection_valid = MagicMock(return_value=False)

    conn = MagicMock()
    pool.return_connection(config, conn)
    conn.close.assert_called_once()

    pool._pools["missing-lock-key"] = [(MagicMock(), 0.0)]
    pool._cleanup_expired_connections()
    pool.shutdown()
    assert pool._shutdown is True


def test_clickzetta_pool_cleanup_thread_and_worker_exception_paths(clickzetta_module, monkeypatch: pytest.MonkeyPatch):
    pool = clickzetta_module.ClickzettaConnectionPool.__new__(clickzetta_module.ClickzettaConnectionPool)
    pool._shutdown = False

    def _cleanup_then_fail():
        pool._shutdown = True
        raise RuntimeError("cleanup failed")

    pool._cleanup_expired_connections = MagicMock(side_effect=_cleanup_then_fail)
    monkeypatch.setattr(clickzetta_module.time, "sleep", lambda _s: None)

    class _Thread:
        def __init__(self, target, daemon):
            self._target = target
            self.daemon = daemon

        def start(self):
            self._target()

    monkeypatch.setattr(clickzetta_module.threading, "Thread", _Thread)
    pool._start_cleanup_thread()
    pool._cleanup_expired_connections.assert_called_once()


def test_clickzetta_parse_metadata_and_write_worker_additional_branches(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)

    parsed_non_dict = vector._parse_metadata("[1,2,3]", "row-1")
    assert parsed_non_dict["doc_id"] == "row-1"
    assert parsed_non_dict["document_id"] == "row-1"

    parsed_none = vector._parse_metadata(None, "row-2")
    assert parsed_none["doc_id"] == "row-2"
    assert parsed_none["document_id"] == "row-2"

    clickzetta_module.ClickzettaVector._shutdown = False
    clickzetta_module.ClickzettaVector._write_queue = None
    clickzetta_module.ClickzettaVector._write_worker()

    class _BadQueue:
        def get(self, timeout):
            clickzetta_module.ClickzettaVector._shutdown = True
            raise RuntimeError("queue failed")

    clickzetta_module.ClickzettaVector._shutdown = False
    clickzetta_module.ClickzettaVector._write_queue = _BadQueue()
    clickzetta_module.ClickzettaVector._write_worker()


def test_clickzetta_inverted_index_existing_and_insert_non_dict_metadata(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._table_name = "table_1"
    cursor = MagicMock()
    cursor.fetchall.return_value = [("idx_table_1_text", "INVERTED", "page_content")]
    cursor.execute.side_effect = [
        None,
        RuntimeError("already has index with the same type cannot create inverted index"),
        None,
    ]

    vector._create_inverted_index(cursor)

    vector._safe_doc_id = MagicMock(side_effect=lambda value: str(value))

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor_obj = MagicMock()
        cursor_obj.__enter__.return_value = cursor_obj
        cursor_obj.__exit__.return_value = None
        connection.cursor.return_value = cursor_obj
        yield connection

    vector.get_connection_context = _ctx
    vector._insert_batch(
        [SimpleNamespace(page_content="content", metadata="not-a-dict")],
        [[0.1, 0.2]],
        ["doc-1"],
        0,
        1,
        1,
    )


def test_clickzetta_full_text_table_missing_and_non_dict_metadata(clickzetta_module):
    vector = clickzetta_module.ClickzettaVector.__new__(clickzetta_module.ClickzettaVector)
    vector._config = _config(clickzetta_module)
    vector._config.enable_inverted_index = True
    vector._table_name = "table_1"

    vector._table_exists = MagicMock(return_value=False)
    assert vector.search_by_full_text("query") == []

    vector._table_exists = MagicMock(return_value=True)

    @contextmanager
    def _ctx():
        connection = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.__exit__.return_value = None
        cursor.fetchall.return_value = [
            ("seg-1", "content-1", "[1,2,3]"),
            ("seg-2", "content-2", None),
        ]
        connection.cursor.return_value = cursor
        yield connection

    vector.get_connection_context = _ctx
    docs = vector.search_by_full_text("query")
    assert len(docs) == 2
    assert docs[0].metadata["doc_id"] == "seg-1"
    assert docs[1].metadata["doc_id"] == "seg-2"
