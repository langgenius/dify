from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from unittest.mock import patch

import pymysql
import pytest

from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus
from services.knowledge_fs.text_store import TextIndexPendingError, configured_text_client, execute_text_request
from services.knowledge_fs.text_store_tidb import TidbTextStore, _sql_endpoint
from services.knowledge_fs.vector_store import VectorStoreUnavailableError
from tests.unit_tests.services.test_knowledge_fs_text_store import GENERATION, A, point, request


@dataclass
class _FakeCursor:
    """pymysql cursor double: queued fetchone rows win over the steady fetchone value."""

    fetchone_queue: list[object] = field(default_factory=list)
    fetchone_value: object = (1,)
    fetchall_value: list[tuple[object, ...]] = field(default_factory=list)
    execute_error: BaseException | Callable[..., None] | None = None
    executed: list[tuple[object, ...]] = field(default_factory=list)
    executemany_calls: list[tuple[str, Sequence[object]]] = field(default_factory=list)

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, *_exc_info: object) -> None:
        return None

    def execute(self, sql: str, *args: object) -> None:
        self.executed.append((sql, *args))
        if isinstance(self.execute_error, BaseException):
            raise self.execute_error
        if self.execute_error is not None:
            self.execute_error(sql, *args)

    def executemany(self, sql: str, rows: Sequence[object]) -> None:
        self.executemany_calls.append((sql, rows))

    def fetchone(self) -> object:
        if self.fetchone_queue:
            return self.fetchone_queue.pop(0)
        return self.fetchone_value

    def fetchall(self) -> list[tuple[object, ...]]:
        return self.fetchall_value


@dataclass
class _FakeConnection:
    cursor_double: _FakeCursor = field(default_factory=_FakeCursor)
    close_count: int = 0

    def cursor(self) -> _FakeCursor:
        return self.cursor_double

    def close(self) -> None:
        self.close_count += 1


@pytest.fixture
def connection() -> _FakeConnection:
    return _FakeConnection()


@pytest.fixture
def cursor(connection: _FakeConnection) -> _FakeCursor:
    return connection.cursor_double


@pytest.fixture
def store(connection: _FakeConnection):
    return TidbTextStore(connection)  # type: ignore[arg-type]


def test_native_tidb_ddl_write_readback_query_and_delete(store, connection, cursor):
    cursor.fetchone_queue = [None, None, (1,)]
    execute_text_request(store, request("upsert", points=[point()]))
    sqls = [call[0] for call in cursor.executed]
    assert any("FULLTEXT INDEX" in sql and "MULTILINGUAL" in sql for sql in sqls)
    assert "ON DUPLICATE KEY UPDATE id=id" in cursor.executemany_calls[-1][0]
    cursor.fetchone_queue = []
    cursor.fetchone_value = (1,)
    cursor.fetchall_value = [(A, GENERATION, point()["content_hash"], point()["text"])]
    assert execute_text_request(store, request("get", ids=[A]))["points"] == [point()]
    cursor.fetchall_value = [(A, 1.25)]
    assert execute_text_request(store, request("search", ids=[A], query="退 款"))["matches"] == [
        {"id": A, "score": 1.25}
    ]
    sql, params = cursor.executed[-1]
    assert "IGNORE INDEX (PRIMARY)" in sql
    assert "READ_FROM_STORAGE(TIFLASH[" in sql
    assert "CONCAT(' ',text,' ') LIKE %s ESCAPE '!'" in sql
    assert "id IN (%s)" in sql
    assert params == ("退 款", "退 款", A, "% 款 %", "% 退 %", 10)
    cursor.fetchall_value = []
    execute_text_request(store, request("delete", ids=[A]))
    cursor.fetchall_value = [(A, GENERATION, point()["content_hash"], point()["text"])]
    with pytest.raises(VectorStoreUnavailableError, match="not visible"):
        execute_text_request(store, request("delete", ids=[A]))
    store.close()
    assert connection.close_count == 1


@pytest.mark.parametrize("operation", ["get", "delete", "search"])
def test_missing_index_distinct_from_provider_failure(store, cursor, operation):
    cursor.fetchone_value = None
    payload = request(operation, ids=[A], **({"query": "refund"} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_text_request(store, payload)
    else:
        assert execute_text_request(store, payload) == {"points": [], "matches": []}
    cursor.execute_error = OSError("unavailable")
    with pytest.raises(OSError):
        execute_text_request(store, payload)


@pytest.mark.parametrize("replica", [None, (0,)])
def test_unready_columnar_index_requires_retry(store, cursor, replica):
    cursor.fetchone_queue = [(1,), replica]
    with pytest.raises(TextIndexPendingError):
        execute_text_request(store, request("search", ids=[A], query="refund"))


@pytest.mark.parametrize("code", [1061, 8200])
def test_concurrent_ddl_only_accepts_duplicate_index(store, cursor, code):
    cursor.fetchone_queue = [(1,), None, (1,)]

    def execute(sql, *_args):
        if "ALTER TABLE" in sql:
            raise pymysql.err.OperationalError(code, "duplicate or unsupported")

    cursor.execute_error = execute
    if code == 1061:
        execute_text_request(store, request("upsert", points=[point()]))
    else:
        with pytest.raises(pymysql.err.OperationalError):
            execute_text_request(store, request("upsert", points=[point()]))


def test_uses_existing_dify_tenant_binding_and_tls_metadata_endpoint(config_overrides):
    config_overrides(VECTOR_STORE="tidb_on_qdrant")
    config_overrides(TIDB_API_URL="https://cloud.example.test")
    config_overrides(TIDB_PUBLIC_KEY="test-public")
    config_overrides(TIDB_PRIVATE_KEY="test-private")
    binding = TidbAuthBinding(
        tenant_id=A,
        cluster_id="cluster-test",
        cluster_name="cluster",
        active=True,
        status=TidbAuthBindingStatus.ACTIVE,
        account="test-account",
        password="test-password",
    )
    _sql_endpoint.cache_clear()
    with (
        patch("services.tidb_binding_service.resolve_tidb_auth_binding", return_value=binding) as resolver,
        patch(
            "dify_vdb_tidb_on_qdrant.tidb_service.TidbService.get_tidb_serverless_cluster",
            return_value={"endpoints": {"public": {"host": "tenant.example.test", "port": 4000}}},
        ) as metadata,
        patch("pymysql.connect") as connect,
    ):
        with configured_text_client(A, allow_create=False) as native:
            assert isinstance(native, TidbTextStore)
        resolver.assert_called_once_with(A, allow_create=False)
        kwargs = connect.call_args.kwargs
        assert kwargs["host"] == "tenant.example.test"
        assert kwargs["user"] == binding.account
        assert kwargs["database"] == "ai"
        assert kwargs["autocommit"] is True
        assert kwargs["ssl"].check_hostname
        assert _sql_endpoint("cluster-test") == ("tenant.example.test", 4000)
        metadata.assert_called_once()
        connect.return_value.close.assert_called_once()
    _sql_endpoint.cache_clear()


def test_missing_cloud_endpoint_config_and_missing_cluster_fail_closed(config_overrides):
    _sql_endpoint.cache_clear()
    config_overrides(TIDB_API_URL=None)
    with pytest.raises(VectorStoreUnavailableError, match="not configured"):
        _sql_endpoint("missing")
    config_overrides(TIDB_API_URL="https://cloud.example.test")
    config_overrides(TIDB_PUBLIC_KEY="test-public")
    config_overrides(TIDB_PRIVATE_KEY="test-private")
    with patch("dify_vdb_tidb_on_qdrant.tidb_service.TidbService.get_tidb_serverless_cluster", return_value=None):
        with pytest.raises(VectorStoreUnavailableError, match="unavailable"):
            _sql_endpoint("missing")
    _sql_endpoint.cache_clear()
