from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pymysql
import pytest

from configs import dify_config
from services.knowledge_fs.text_store import TextIndexPendingError, configured_text_client, execute_text_request
from services.knowledge_fs.text_store_tidb import TidbTextStore, _sql_endpoint
from services.knowledge_fs.vector_store import VectorStoreUnavailableError
from tests.unit_tests.services.test_knowledge_fs_text_store import GENERATION, A, point, request


@pytest.fixture
def store():
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = []
    return TidbTextStore(connection)


def test_native_tidb_ddl_write_readback_query_and_delete(store):
    cursor = store.connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [None, None, (1,)]
    execute_text_request(store, request("upsert", points=[point()]))
    sqls = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("FULLTEXT INDEX" in sql and "MULTILINGUAL" in sql for sql in sqls)
    assert "ON DUPLICATE KEY UPDATE id=id" in cursor.executemany.call_args.args[0]
    cursor.fetchone.side_effect = None
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [(A, GENERATION, point()["content_hash"], point()["text"])]
    assert execute_text_request(store, request("get", ids=[A]))["points"] == [point()]
    cursor.fetchall.return_value = [(A, 1.25)]
    assert execute_text_request(store, request("search", ids=[A], query="退 款"))["matches"] == [
        {"id": A, "score": 1.25}
    ]
    sql, params = cursor.execute.call_args.args
    assert "IGNORE INDEX (PRIMARY)" in sql
    assert "READ_FROM_STORAGE(TIFLASH[" in sql
    assert "CONCAT(' ',text,' ') LIKE %s ESCAPE '!'" in sql
    assert "id IN (%s)" in sql
    assert params == ("退 款", "退 款", A, "% 款 %", "% 退 %", 10)
    cursor.fetchall.return_value = []
    execute_text_request(store, request("delete", ids=[A]))
    cursor.fetchall.return_value = [(A, GENERATION, point()["content_hash"], point()["text"])]
    with pytest.raises(VectorStoreUnavailableError, match="not visible"):
        execute_text_request(store, request("delete", ids=[A]))
    store.close()
    store.connection.close.assert_called_once()


@pytest.mark.parametrize("operation", ["get", "delete", "search"])
def test_missing_index_distinct_from_provider_failure(store, operation):
    cursor = store.connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = None
    payload = request(operation, ids=[A], **({"query": "refund"} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_text_request(store, payload)
    else:
        assert execute_text_request(store, payload) == {"points": [], "matches": []}
    cursor.execute.side_effect = OSError("unavailable")
    with pytest.raises(OSError):
        execute_text_request(store, payload)


@pytest.mark.parametrize("replica", [None, (0,)])
def test_unready_columnar_index_requires_retry(store, replica):
    cursor = store.connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [(1,), replica]
    with pytest.raises(TextIndexPendingError):
        execute_text_request(store, request("search", ids=[A], query="refund"))


@pytest.mark.parametrize("code", [1061, 8200])
def test_concurrent_ddl_only_accepts_duplicate_index(store, code):
    cursor = store.connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [(1,), None, (1,)]

    def execute(sql, *_args):
        if "ALTER TABLE" in sql:
            raise pymysql.err.OperationalError(code, "duplicate or unsupported")

    cursor.execute.side_effect = execute
    if code == 1061:
        execute_text_request(store, request("upsert", points=[point()]))
    else:
        with pytest.raises(pymysql.err.OperationalError):
            execute_text_request(store, request("upsert", points=[point()]))


def test_uses_existing_dify_tenant_binding_and_tls_metadata_endpoint(monkeypatch):
    monkeypatch.setattr(dify_config, "VECTOR_STORE", "tidb_on_qdrant")
    monkeypatch.setattr(dify_config, "TIDB_API_URL", "https://cloud.example.test")
    monkeypatch.setattr(dify_config, "TIDB_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(dify_config, "TIDB_PRIVATE_KEY", "test-private")
    binding = SimpleNamespace(cluster_id="cluster-test", account="test-account", password="test-password")
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


def test_missing_cloud_endpoint_config_and_missing_cluster_fail_closed(monkeypatch):
    _sql_endpoint.cache_clear()
    monkeypatch.setattr(dify_config, "TIDB_API_URL", None)
    with pytest.raises(VectorStoreUnavailableError, match="not configured"):
        _sql_endpoint("missing")
    monkeypatch.setattr(dify_config, "TIDB_API_URL", "https://cloud.example.test")
    monkeypatch.setattr(dify_config, "TIDB_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(dify_config, "TIDB_PRIVATE_KEY", "test-private")
    with patch("dify_vdb_tidb_on_qdrant.tidb_service.TidbService.get_tidb_serverless_cluster", return_value=None):
        with pytest.raises(VectorStoreUnavailableError, match="unavailable"):
            _sql_endpoint("missing")
    _sql_endpoint.cache_clear()
