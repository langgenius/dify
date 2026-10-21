import hashlib
import inspect
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from unittest.mock import call, patch

import gevent
import pymysql
import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, NotFound, ServiceUnavailable

from controllers.inner_api import inner_api_ns
from controllers.inner_api.knowledge_fs.texts import KnowledgeFSTextApi
from libs.external_api import ExternalApi
from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus
from services.knowledge_fs.text_store import TextIndexPendingError
from services.knowledge_fs.vector_store import VectorResult
from services.tidb_binding_service import TidbBindingPendingError

PAYLOAD = {
    "operation": "get",
    "scope": {
        "tenant_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0001",
        "knowledge_space_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0002",
        "index_version": "fts-v1",
    },
    "ids": ["018f0d60-7a49-7cc2-9c1b-5b36f18f0004"],
}


@pytest.mark.parametrize("deadline", ["invalid", "NaN", "1.5", "-1", "9" * 30])
def test_search_rejects_invalid_deadline_before_provider_io(app: Flask, deadline: str) -> None:
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(
            json={**PAYLOAD, "operation": "search", "query": "refund"},
            headers={"X-Knowledge-FS-Deadline-Ms": deadline},
        ),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client") as client,
    ):
        with pytest.raises(BadRequest):
            inspect.unwrap(handler.post)(handler)
        client.assert_not_called()


def test_search_rejects_expired_deadline_before_provider_io(app: Flask) -> None:
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(
            json={**PAYLOAD, "operation": "search", "query": "refund"},
            headers={"X-Knowledge-FS-Deadline-Ms": str(int(time.time() * 1000) - 1)},
        ),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client") as client,
    ):
        with pytest.raises(ServiceUnavailable):
            inspect.unwrap(handler.post)(handler)
        client.assert_not_called()


def test_legacy_search_without_deadline_is_still_bounded(app: Flask) -> None:
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(json={**PAYLOAD, "operation": "search", "query": "refund"}),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client") as client,
        patch(
            "controllers.inner_api.knowledge_fs.texts.execute_text_request",
            return_value={"points": [], "matches": []},
        ),
    ):
        assert inspect.unwrap(handler.post)(handler) == {"points": [], "matches": []}
        assert 49 < client.call_args.kwargs["deadline"].remaining() <= 50


@pytest.mark.parametrize("stage", ["connect", "query"])
def test_search_deadline_interrupts_stalled_backend_and_runs_cleanup(app: Flask, stage: str) -> None:
    cleaned_up = False

    @contextmanager
    def stalled_client(*_args: object, **_kwargs: object) -> Generator[object]:
        nonlocal cleaned_up
        try:
            if stage == "connect":
                gevent.sleep(1)
            yield object()
        finally:
            cleaned_up = True

    def execute(*_args: object) -> VectorResult:
        gevent.sleep(1)
        return {"points": [], "matches": []}

    handler = KnowledgeFSTextApi()
    started = time.monotonic()
    with (
        app.test_request_context(
            json={**PAYLOAD, "operation": "search", "query": "refund"},
            headers={"X-Knowledge-FS-Deadline-Ms": str(int(time.time() * 1000) + 50)},
        ),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client", stalled_client),
        patch("controllers.inner_api.knowledge_fs.texts.execute_text_request", execute),
    ):
        with pytest.raises(ServiceUnavailable):
            inspect.unwrap(handler.post)(handler)
    assert cleaned_up
    assert time.monotonic() - started < 0.5


def test_text_controller_rejects_unauthenticated_requests(app: Flask) -> None:
    with app.test_request_context(json=PAYLOAD):
        with pytest.raises(NotFound):
            KnowledgeFSTextApi().post()


def test_text_controller_validates_before_opening_backend(app: Flask) -> None:
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(json={**PAYLOAD, "endpoint": "http://untrusted"}),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client") as client,
    ):
        with pytest.raises(BadRequest):
            inspect.unwrap(handler.post)(handler)
        client.assert_not_called()


def test_text_controller_hides_provider_credentials(app: Flask) -> None:
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch(
            "controllers.inner_api.knowledge_fs.texts.configured_text_client",
            side_effect=RuntimeError("private-api-key"),
        ),
    ):
        with pytest.raises(ServiceUnavailable) as error:
            inspect.unwrap(handler.post)(handler)
        assert "private-api-key" not in str(error.value)
        assert error.value.__suppress_context__


def test_text_controller_serializes_successful_response(app: Flask) -> None:
    handler = KnowledgeFSTextApi()
    result: dict[str, list[dict[str, object]]] = {"points": [], "matches": [{"id": PAYLOAD["ids"][0], "score": 0.75}]}
    with (
        app.test_request_context(json=PAYLOAD),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client"),
        patch("controllers.inner_api.knowledge_fs.texts.execute_text_request", return_value=result),
    ):
        assert inspect.unwrap(handler.post)(handler) == result


def test_text_controller_accepts_only_configured_inner_key(app: Flask, config_overrides: Callable[..., None]) -> None:
    config_overrides(PLUGIN_DAEMON_KEY="enabled", INNER_API_KEY_FOR_PLUGIN="trusted-key")
    with (
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client") as client,
        patch(
            "controllers.inner_api.knowledge_fs.texts.execute_text_request",
            return_value={"points": [], "matches": []},
        ),
    ):
        for key in [None, "wrong-key"]:
            with app.test_request_context(json=PAYLOAD, headers={"X-Inner-Api-Key": key} if key else {}):
                with pytest.raises(NotFound):
                    KnowledgeFSTextApi().post()
        client.assert_not_called()
        with app.test_request_context(json=PAYLOAD, headers={"X-Inner-Api-Key": "trusted-key"}):
            assert KnowledgeFSTextApi().post() == {"points": [], "matches": []}
            client.assert_called_once_with(PAYLOAD["scope"]["tenant_id"], allow_create=False)


def test_text_controller_reports_pending_index_without_leaking_credentials(app: Flask) -> None:
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch(
            "controllers.inner_api.knowledge_fs.texts.configured_text_client",
            side_effect=TextIndexPendingError("secret"),
        ),
    ):
        with pytest.raises(ServiceUnavailable) as error:
            inspect.unwrap(handler.post)(handler)
        assert error.value.retry_after == 5
        assert "secret" not in str(error.value)


@pytest.mark.parametrize("pending_error", [TidbBindingPendingError, TextIndexPendingError])
def test_http_pending_response_preserves_retry_after_header(
    config_overrides: Callable[..., None], pending_error: type[Exception]
) -> None:
    config_overrides(PLUGIN_DAEMON_KEY="enabled", INNER_API_KEY_FOR_PLUGIN="trusted-key")
    http_app = Flask(__name__)
    api = ExternalApi(http_app)
    api.models.update(inner_api_ns.models)
    api.add_resource(KnowledgeFSTextApi, "/texts")
    with patch(
        "controllers.inner_api.knowledge_fs.texts.configured_text_client",
        side_effect=pending_error("private endpoint"),
    ):
        response = http_app.test_client().post("/texts", json=PAYLOAD, headers={"X-Inner-Api-Key": "trusted-key"})

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"
    assert response.mimetype == "application/json"
    assert response.get_json() == {
        "code": "service_unavailable",
        "message": "KnowledgeFS full-text index is being initialized",
        "status": 503,
    }


def test_http_cleanup_after_interrupted_first_write_does_not_initialize_database(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(VECTOR_STORE="tidb_on_qdrant", PLUGIN_DAEMON_KEY="enabled", INNER_API_KEY_FOR_PLUGIN="trusted-key")
    http_app = Flask(__name__)
    api = ExternalApi(http_app)
    api.models.update(inner_api_ns.models)
    api.add_resource(KnowledgeFSTextApi, "/texts")
    binding = TidbAuthBinding(
        tenant_id=PAYLOAD["scope"]["tenant_id"],
        cluster_id="created-cluster",
        cluster_name="tenant-cluster",
        account="tenant.root",
        password="test-password",
        active=True,
        status=TidbAuthBindingStatus.ACTIVE,
    )
    text = "refund policy"
    upsert = {
        "operation": "upsert",
        "scope": PAYLOAD["scope"],
        "points": [
            {
                "id": PAYLOAD["ids"][0],
                "generation_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0003",
                "content_hash": hashlib.sha256(text.encode()).hexdigest(),
                "text": text,
            }
        ],
    }
    with (
        patch(
            "services.tidb_binding_service.resolve_tidb_auth_binding",
            side_effect=[TidbBindingPendingError(), binding, binding, binding, binding],
        ) as resolver,
        patch("services.knowledge_fs.text_store_tidb._sql_endpoint", return_value=("tenant.test", 4000)),
        patch("pymysql.connect") as connect,
    ):
        connection = connect.return_value

        def open_connection(**kwargs: object) -> object:
            if kwargs.get("database") == "ai":
                raise pymysql.err.OperationalError(1049, "Unknown database 'ai'")
            return connection

        def read_only_sql(sql: str, *_args: object) -> None:
            assert sql.lstrip().upper().startswith("SELECT "), sql

        connect.side_effect = open_connection
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.execute.side_effect = read_only_sql
        cursor.fetchone.return_value = None
        client = http_app.test_client()
        headers = {"X-Inner-Api-Key": "trusted-key"}

        # Provisioning was committed, but the writer stopped before initializing SQL storage.
        response = client.post("/texts", json=upsert, headers=headers)
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "5"
        connect.assert_not_called()

        for operation in ("delete", "get", "delete", "get"):
            response = client.post("/texts", json={**PAYLOAD, "operation": operation}, headers=headers)
            assert response.status_code == 200
            assert response.get_json() == {"points": [], "matches": []}
            assert "Retry-After" not in response.headers

        assert resolver.call_args_list == [
            call(PAYLOAD["scope"]["tenant_id"], allow_create=True),
            *[call(PAYLOAD["scope"]["tenant_id"], allow_create=False)] * 4,
        ]
        assert connect.call_count == 4
        connection.select_db.assert_not_called()
        assert connection.close.call_count == 4
