"""HTTP authentication and acknowledgement backed by the real SQLite collector."""

from collections.abc import Iterator
from dataclasses import replace
from uuid import uuid4

import pytest
from dify_trace_sdk.testing import RecordingEgress
from flask import Flask
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.inner_api import bp
from extensions.ext_application_services import ApplicationServices
from models.application_trace import ApplicationTraceBatch
from repositories.trace_record_repository import TraceRecordRepository
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.collection import AgentTraceSettings, ScheduleTraceExport
from services.tracing.providers import ProviderConfigCodec
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.services.tracing_ports import (
    AGENT_TRACE_SETTINGS,
    InstalledTraceProviders,
    WorkspaceBoundCipher,
)
from tests.unit_tests.repositories.test_application_trace_repository import Collection, batch_for, seed

BATCHES_URL = "/inner/api/agent/tracing/batches"
INNER_API_HEADERS = {"X-Inner-Api-Key": "inner"}


@pytest.fixture
def inner_app() -> Iterator[Flask]:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with config_overrides_context(PLUGIN_DAEMON_KEY="daemon", INNER_API_KEY_FOR_PLUGIN="inner"):
        yield app


def bind_collector(
    app: Flask,
    services: ApplicationServices,
    collection: Collection,
    *,
    settings: AgentTraceSettings,
    schedule_export: ScheduleTraceExport,
) -> None:
    """Make the app's composition root hand the ingestion handler a collector over the seeded ledger."""
    collector = ApplicationTracingService(
        traces=collection.repository,
        records=TraceRecordRepository(collection.sessions, files_url="https://files.test", enterprise_details=False),
        builder=CanonicalTraceBuilder(),
        providers=InstalledTraceProviders(),
        codec=ProviderConfigCodec(WorkspaceBoundCipher()),
        # Ingesting batches never exports; an unexpected request fails the test.
        egress=RecordingEgress([], grpc_target=None),
        schedule_export=schedule_export,
        settings=settings,
    )
    app.extensions["application_services"] = replace(
        services, tracing=replace(services.tracing, agent_traces=collector)
    )


def stored_batches(sessions: sessionmaker[Session]) -> int | None:
    with sessions() as session:
        return session.scalar(select(func.count()).select_from(ApplicationTraceBatch))


def test_trace_http_ack_follows_commit_and_replay_is_idempotent(
    inner_app: Flask,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    collection = seed(sqlite_session_factory, "http")
    payload = batch_for(collection.run, collection.invocation()).model_dump(mode="json")
    scheduled: list[str] = []

    def schedule(run_id: str) -> None:
        # A fresh transaction can see the batch before the caller gets an ACK.
        assert stored_batches(sqlite_session_factory) == 1
        scheduled.append(run_id)

    bind_collector(
        inner_app, account_application_services, collection, settings=AGENT_TRACE_SETTINGS, schedule_export=schedule
    )
    client = inner_app.test_client()
    for _ in range(2):
        response = client.post(BATCHES_URL, json=payload, headers=INNER_API_HEADERS)
        assert response.status_code == 200
        assert response.get_json() == {"result": "success", "batch_id": payload["batch_id"], "accepted_spans": 1}
    assert scheduled == [collection.run.id, collection.run.id]

    payload["spans"][0]["name"] = "conflicting replay"
    response = client.post(BATCHES_URL, json=payload, headers=INNER_API_HEADERS)
    assert response.status_code == 409
    assert len(scheduled) == 2


@pytest.mark.parametrize("header", [{}, {"X-Inner-Api-Key": "wrong"}])
def test_trace_http_requires_internal_auth(inner_app: Flask, header: dict[str, str]) -> None:
    response = inner_app.test_client().post(BATCHES_URL, json={}, headers=header)
    assert response.status_code == 404


def test_trace_http_rejects_invalid_span_and_unknown_owner(
    inner_app: Flask,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    collection = seed(sqlite_session_factory, "http-validation")
    payload = batch_for(collection.run, collection.invocation()).model_dump(mode="json")
    scheduled: list[str] = []
    bind_collector(
        inner_app,
        account_application_services,
        collection,
        settings=AGENT_TRACE_SETTINGS,
        schedule_export=scheduled.append,
    )
    client = inner_app.test_client()
    payload["spans"][0]["end_time_ns"] = 0
    response = client.post(BATCHES_URL, json=payload, headers=INNER_API_HEADERS)
    assert response.status_code == 400
    payload["spans"][0]["end_time_ns"] = 2_000_000_000
    payload["invocation_id"] = str(uuid4())
    response = client.post(BATCHES_URL, json=payload, headers=INNER_API_HEADERS)
    assert response.status_code == 404
    assert scheduled == []
    assert stored_batches(sqlite_session_factory) == 0


def test_trace_http_rejects_batches_beyond_collection_limits(
    inner_app: Flask,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    collection = seed(sqlite_session_factory, "http-limits")
    payload = batch_for(collection.run, collection.invocation()).model_dump(mode="json")
    scheduled: list[str] = []
    bind_collector(
        inner_app,
        account_application_services,
        collection,
        settings=replace(AGENT_TRACE_SETTINGS, max_spans=0),
        schedule_export=scheduled.append,
    )
    response = inner_app.test_client().post(BATCHES_URL, json=payload, headers=INNER_API_HEADERS)
    assert response.status_code == 413
    body = response.get_json()
    assert body is not None
    assert body["message"] == "tracing_payload_limit"
    assert scheduled == []
    assert stored_batches(sqlite_session_factory) == 0


def test_trace_http_enforces_body_limit_before_ingestion(
    inner_app: Flask,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    collection = seed(sqlite_session_factory, "http-body-limit")
    payload = batch_for(collection.run, collection.invocation()).model_dump(mode="json")
    scheduled: list[str] = []
    bind_collector(
        inner_app,
        account_application_services,
        collection,
        settings=AGENT_TRACE_SETTINGS,
        schedule_export=scheduled.append,
    )
    with config_overrides_context(OPS_AGENT_TRACE_BATCH_MAX_BYTES=64):
        response = inner_app.test_client().post(BATCHES_URL, json=payload, headers=INNER_API_HEADERS)
    assert response.status_code == 413
    assert scheduled == []
    assert stored_batches(sqlite_session_factory) == 0
