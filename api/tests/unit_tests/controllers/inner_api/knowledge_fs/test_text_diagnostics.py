"""Exercise provider failures through the real HTTP bridge and TiDB store."""

import json
import logging
import time
from collections.abc import Callable
from unittest.mock import patch
from uuid import UUID

import pymysql
import pytest
from flask import Flask
from flask.testing import FlaskClient

from controllers.inner_api import inner_api_ns
from controllers.inner_api.knowledge_fs.texts import KnowledgeFSTextApi
from libs.external_api import ExternalApi
from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus
from services.knowledge_fs.text_store import TextIndexPendingError

REQUEST_ID = "d4103b40-0744-458f-a740-d8047d1cbe8d"
HEADERS = {"X-Inner-Api-Key": "trusted-key", "X-Knowledge-FS-Request-Id": REQUEST_ID}
PAYLOAD = {
    "operation": "search",
    "scope": {
        "tenant_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0001",
        "knowledge_space_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0002",
        "index_version": "private-index-version",
    },
    "ids": ["018f0d60-7a49-7cc2-9c1b-5b36f18f0004"],
    "query": "private-search-content",
}


@pytest.fixture
def http_client(config_overrides: Callable[..., None]) -> FlaskClient:
    config_overrides(VECTOR_STORE="tidb_on_qdrant", PLUGIN_DAEMON_KEY="enabled", INNER_API_KEY_FOR_PLUGIN="trusted-key")
    app = Flask(__name__)
    api = ExternalApi(app)
    api.models.update(inner_api_ns.models)
    api.add_resource(KnowledgeFSTextApi, "/texts")
    return app.test_client()


@pytest.mark.parametrize("stage", ["connect", "index_check", "replica_readiness", "search"])
def test_database_failure_retains_code_stage_and_correlation_without_secrets(
    http_client: FlaskClient, caplog: pytest.LogCaptureFixture, stage: str
) -> None:
    error = pymysql.err.OperationalError(
        1815, "private-password private-search-content SELECT text FROM private-table at private-host"
    )
    binding = TidbAuthBinding(
        tenant_id=PAYLOAD["scope"]["tenant_id"],
        cluster_id="private-cluster",
        cluster_name="private-cluster-name",
        account="private-account",
        password="private-password",
        active=True,
        status=TidbAuthBindingStatus.ACTIVE,
    )
    with (
        patch("services.tidb_binding_service.resolve_tidb_auth_binding", return_value=binding),
        patch("services.knowledge_fs.text_store_tidb._sql_endpoint", return_value=("private-host", 4000)),
        patch("pymysql.connect") as connect,
        caplog.at_level(logging.WARNING),
    ):
        connection = connect.return_value
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)

        def execute(sql: str, *_args: object) -> None:
            if (
                (stage == "index_check" and "information_schema.TABLES" in sql)
                or (stage == "replica_readiness" and "information_schema.TIFLASH_REPLICA" in sql)
                or (stage == "search" and "fts_match_word" in sql)
            ):
                raise error

        cursor.execute.side_effect = execute
        if stage == "connect":
            connect.side_effect = error
        if stage == "search":
            # Cleanup must not replace the SQL failure with an unrelated secondary error.
            connection.close.side_effect = OSError("private-cleanup-error")
        response = http_client.post("/texts", json=PAYLOAD, headers=HEADERS)

    assert response.status_code == 503
    assert response.get_json() == {
        "code": "service_unavailable",
        "message": "KnowledgeFS full-text backend is unavailable",
        "status": 503,
    }
    assert response.headers["X-Knowledge-FS-Request-Id"] == REQUEST_ID
    records = [r for r in caplog.records if "knowledge_fs.text_backend_failure" in r.getMessage()]
    assert len(records) == 1
    record = records[0]
    attributes = record.__dict__["attributes"]
    assert attributes["request_id"] == REQUEST_ID
    assert attributes["tenant_id"] == PAYLOAD["scope"]["tenant_id"]
    assert attributes["knowledge_space_id"] == PAYLOAD["scope"]["knowledge_space_id"]
    assert attributes["provider"] == "tidb_on_qdrant"
    assert attributes["operation"] == "search"
    assert attributes["stage"] == stage
    assert attributes["elapsed_ms"] >= attributes["stage_elapsed_ms"] >= 0
    assert attributes["errors"][0]["type"] == "pymysql.err.OperationalError"
    assert attributes["errors"][0]["db_error_code"] == 1815
    assert attributes["errors"][0]["db_error_name"] == "INTERNAL_ERROR"
    assert attributes["errors"][0]["frames"]
    # Both text and structured JSON logs must contain diagnostics, never raw provider data.
    assert "1815" in record.getMessage()
    assert stage in record.getMessage()
    assert record.exc_info is None
    serialized = caplog.text + json.dumps(attributes) + response.get_data(as_text=True)
    for secret in (
        "private-password",
        "private-search-content",
        "private-table",
        "private-host",
        "private-account",
        "private-cluster",
        "private-index-version",
        "private-cleanup-error",
    ):
        assert secret not in serialized


def test_deadline_failure_is_diagnosable_before_connect(
    http_client: FlaskClient, caplog: pytest.LogCaptureFixture
) -> None:
    response = http_client.post(
        "/texts",
        json=PAYLOAD,
        headers={**HEADERS, "X-Knowledge-FS-Deadline-Ms": str(int(time.time() * 1000) - 1)},
    )
    assert response.status_code == 503
    attributes = next(r.__dict__["attributes"] for r in caplog.records if "text_backend_failure" in r.getMessage())
    assert attributes["stage"] == "deadline"
    assert attributes["errors"][0]["type"].endswith("TextSearchTimeoutError")


def test_pending_index_keeps_retry_header_and_warning_diagnostic(
    http_client: FlaskClient, caplog: pytest.LogCaptureFixture
) -> None:
    with patch(
        "controllers.inner_api.knowledge_fs.texts.configured_text_client",
        side_effect=TextIndexPendingError("private-pending-message"),
    ):
        response = http_client.post("/texts", json=PAYLOAD, headers=HEADERS)
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"
    record = next(r for r in caplog.records if "text_backend_failure" in r.getMessage())
    assert record.levelno == logging.WARNING
    assert record.__dict__["attributes"]["outcome"] == "pending"
    assert "private-pending-message" not in caplog.text


@pytest.mark.parametrize("request_id", [None, "invalid sensitive value", "a" * 500, REQUEST_ID])
def test_correlation_header_is_bounded_and_does_not_change_success(
    http_client: FlaskClient, request_id: str | None, caplog: pytest.LogCaptureFixture
) -> None:
    headers = {"X-Inner-Api-Key": "trusted-key"}
    if request_id is not None:
        headers["X-Knowledge-FS-Request-Id"] = request_id
    with (
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client"),
        patch(
            "controllers.inner_api.knowledge_fs.texts.execute_text_request", return_value={"points": [], "matches": []}
        ),
    ):
        response = http_client.post("/texts", json=PAYLOAD, headers=headers)
    assert response.status_code == 200
    assert response.get_json() == {"points": [], "matches": []}
    correlation_id = response.headers["X-Knowledge-FS-Request-Id"]
    assert str(UUID(correlation_id)) == correlation_id
    if request_id == REQUEST_ID:
        assert correlation_id == request_id
    assert not [r for r in caplog.records if "text_backend_failure" in r.getMessage()]
