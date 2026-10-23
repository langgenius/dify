"""Exercise Celery entrypoints against durable application trace state."""

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.ops.unified_trace.entities import CanonicalTrace
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceRun
from services.tracing import service as service_module
from services.tracing.provider_dispatch import TraceExportResult
from services.tracing.service import ApplicationTracingService
from tasks.application_trace_task import export_application_trace, reconcile_application_traces
from tests.helpers.unit.config_override import apply_config_overrides
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_batch_for as batch_for
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_ingest as ingest
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_seed as seed
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_terminal as terminal


def test_worker_task_exports_once_and_replayed_task_observes_checkpoint(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = seed(sqlite_session_factory, "worker-task")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    service = ApplicationTracingService(case.repository)
    monkeypatch.setattr(service_module, "application_tracing_service", lambda: service)
    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    exports: list[CanonicalTrace] = []

    def export(_provider: str, _config: dict[str, object], trace: CanonicalTrace) -> TraceExportResult:
        exports.append(trace)
        return TraceExportResult("vendor-id", "https://example.test/trace/vendor-id")

    monkeypatch.setattr(service_module, "export_trace", export)
    export_application_trace.run(case.run.id)
    export_application_trace.run(case.run.id)
    assert len(exports) == 1
    assert exports[0].trace_id == case.run.trace_id
    result = case.repository.get(case.run.id)
    assert result is not None
    assert result.state == "accepted"
    assert result.attempts == 1
    assert result.trace_url == "https://example.test/trace/vendor-id"


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
    service = ApplicationTracingService(due.repository)
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    monkeypatch.setattr(service_module, "application_tracing_service", lambda: service)
    reconcile_application_traces.run()
    assert scheduled == [due.run.id]
    assert due.repository.get(accepted.run.id) is None
    assert due.repository.get(deferred.run.id) is not None
    assert due.repository.get(due.run.id) is not None
