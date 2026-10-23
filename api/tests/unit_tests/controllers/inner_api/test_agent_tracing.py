"""HTTP authentication and acknowledgement backed by the real SQLite collector."""

from collections.abc import Iterator
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.inner_api import bp
from models.application_trace import ApplicationTraceBatch
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.services.tracing.test_application_trace_collection import batch_for, seed


@pytest.fixture
def client() -> Iterator[FlaskClient]:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with config_overrides_context(
        PLUGIN_DAEMON_KEY="daemon", INNER_API_KEY_FOR_PLUGIN="inner", OPS_AGENT_TRACE_ENABLED=True
    ):
        yield app.test_client()


def test_trace_http_ack_follows_commit_and_replay_is_idempotent(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = seed(sqlite_session_factory, "http", capture_content=False)
    invocation = collection.invocation()
    payload = batch_for(collection.run, invocation).model_dump(mode="json")
    service = ApplicationTracingService(collection.repository)
    monkeypatch.setattr("controllers.inner_api.agent.tracing.application_tracing_service", lambda: service)
    scheduled = []

    def schedule(run_id: str) -> None:
        # A fresh transaction can see the batch before the caller gets an ACK.
        with sqlite_session_factory() as session:
            assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 1
        scheduled.append(run_id)

    monkeypatch.setattr(service, "schedule", schedule)
    for _ in range(2):
        response = client.post("/inner/api/agent/tracing/batches", json=payload, headers={"X-Inner-Api-Key": "inner"})
        assert response.status_code == 200
        assert response.get_json() == {"result": "success", "batch_id": payload["batch_id"], "accepted_spans": 1}
    assert scheduled == [collection.run.id, collection.run.id]

    payload["spans"][0]["name"] = "conflicting replay"
    response = client.post("/inner/api/agent/tracing/batches", json=payload, headers={"X-Inner-Api-Key": "inner"})
    assert response.status_code == 409
    assert len(scheduled) == 2


@pytest.mark.parametrize("header", [{}, {"X-Inner-Api-Key": "wrong"}])
def test_trace_http_requires_internal_auth(client: FlaskClient, header: dict[str, str]) -> None:
    response = client.post("/inner/api/agent/tracing/batches", json={}, headers=header)
    assert response.status_code == 404


def test_trace_http_rejects_invalid_span_and_unknown_owner(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = seed(sqlite_session_factory, "http-validation")
    invocation = collection.invocation()
    payload = batch_for(collection.run, invocation).model_dump(mode="json")
    service = ApplicationTracingService(collection.repository)
    monkeypatch.setattr("controllers.inner_api.agent.tracing.application_tracing_service", lambda: service)
    payload["spans"][0]["end_time_ns"] = 0
    response = client.post("/inner/api/agent/tracing/batches", json=payload, headers={"X-Inner-Api-Key": "inner"})
    assert response.status_code == 400
    payload["spans"][0]["end_time_ns"] = 2_000_000_000
    payload["invocation_id"] = str(uuid4())
    response = client.post("/inner/api/agent/tracing/batches", json=payload, headers={"X-Inner-Api-Key": "inner"})
    assert response.status_code == 404
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 0


def test_trace_http_enforces_body_limit_before_ingestion(client: FlaskClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []
    monkeypatch.setattr("controllers.inner_api.agent.tracing.application_tracing_service", lambda: calls.append(True))
    with config_overrides_context(OPS_AGENT_TRACE_BATCH_MAX_BYTES=64):
        response = client.post(
            "/inner/api/agent/tracing/batches", json={"padding": "x" * 256}, headers={"X-Inner-Api-Key": "inner"}
        )
    assert response.status_code == 413
    assert calls == []
