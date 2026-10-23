"""Exercise Celery entrypoints against durable application trace state."""

from datetime import timedelta
from uuid import UUID

import httpx
import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.helper import ssrf_proxy
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceRun
from models.model import AppMode
from services.tracing import service as service_module
from services.tracing.service import application_tracing_service
from tasks.application_trace_task import export_application_trace, reconcile_application_traces
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    attach_conversation,
    batch_for,
    ingest,
    install_decryption,
    message_record,
    no_egress,
    seed,
    terminal,
    tracing_service,
)


@pytest.fixture
def worker_database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """The worker's service factory binds the application engine; bind it to the test database."""
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_engine))


@pytest.mark.usefixtures("worker_database")
def test_worker_task_exports_once_through_the_ssrf_proxy_and_replay_observes_checkpoint(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = seed(sqlite_session_factory, "worker-task")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    install_decryption(monkeypatch)
    proxied: list[tuple[str, str]] = []

    def send(method: str, url: str, **_kwargs: object) -> httpx.Response:
        proxied.append((method, url))
        return httpx.Response(200, json={}, request=httpx.Request(method, url))

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    export_application_trace.run(case.run.id)
    export_application_trace.run(case.run.id)
    assert proxied == [("POST", "https://langfuse.test/api/public/ingestion")]
    result = case.repository.get(case.run.id)
    assert result is not None
    assert result.state == "accepted"
    assert result.attempts == 1
    provider_trace_id = str(UUID(hex=case.run.trace_id))
    assert result.provider_trace_id == provider_trace_id
    assert result.trace_url == f"https://langfuse.test/project/original/traces/{provider_trace_id}"


@pytest.mark.usefixtures("worker_database")
def test_worker_records_carry_no_enterprise_names(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "worker-names")
    attach_conversation(case, AppMode.AGENT)
    record = message_record(application_tracing_service(), case)
    assert (record.metadata["app_name"], record.metadata["workspace_name"]) == ("", "")


def test_reconcile_only_schedules_due_pending_rows_and_applies_retention(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_RETENTION_DAYS=3)
    due = seed(sqlite_session_factory, "due")
    deferred = seed(sqlite_session_factory, "future")
    accepted = seed(sqlite_session_factory, "accepted-expired")
    with sqlite_session_factory.begin() as session:
        future = session.get(ApplicationTraceRun, deferred.run.id)
        expired = session.get(ApplicationTraceRun, accepted.run.id)
        assert future is not None
        assert expired is not None
        future.state = "retrying"
        future.next_attempt_at = naive_utc_now() + timedelta(hours=1)
        expired.state = "accepted"
        expired.created_at = naive_utc_now() - timedelta(days=4)
    service = tracing_service(due, no_egress())
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    monkeypatch.setattr(service_module, "application_tracing_service", lambda: service)
    reconcile_application_traces.run()
    assert scheduled == [due.run.id]
    assert due.repository.get(accepted.run.id) is None
    assert due.repository.get(deferred.run.id) is not None
    assert due.repository.get(due.run.id) is not None
