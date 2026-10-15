"""Real SQLite state transitions and background renewal for delivery leases.

PostgreSQL row-lock scheduling and the deployed Celery pool still need dev
validation; these tests establish token and acknowledgement semantics.
"""

import threading
from datetime import timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceRun
from repositories import application_trace_repository as repository_module
from repositories.application_trace_repository import TraceCollectionError
from services.tracing import service as service_module
from services.tracing.provider_dispatch import TraceExportResult, TraceExportUncertainError
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    batch_for,
    claim,
    ingest,
    seed,
    terminal,
)


@pytest.fixture
def case(sqlite_session_factory: sessionmaker[Session]) -> Collection:
    result = seed(sqlite_session_factory, "lease-test")
    ingest(result, batch_for(result.run, result.invocation()))
    terminal(result)
    return result


def _stored(case: Collection) -> ApplicationTraceRun:
    row = case.repository.get(case.run.id)
    assert row is not None
    return row


def _expire(case: Collection) -> str:
    leased = claim(case)
    assert leased is not None
    with case.sessions.begin() as session:
        row = session.get(ApplicationTraceRun, case.run.id)
        assert row is not None
        row.export_started_at = naive_utc_now() - timedelta(seconds=60)
        row.export_heartbeat_at = row.export_started_at
    assert claim(case) is None
    assert _stored(case).state == "uncertain"
    return leased[1]


def test_renewal_keeps_long_export_alive_then_missing_heartbeat_expires(
    case: Collection, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [naive_utc_now()]
    monkeypatch.setattr(repository_module, "naive_utc_now", lambda: clock[0])
    leased = claim(case)
    assert leased is not None
    token = leased[1]
    clock[0] += timedelta(seconds=20)
    assert case.repository.renew_export_lease(case.run.id, token)
    clock[0] += timedelta(seconds=20)
    assert claim(case) is None
    current = _stored(case)
    assert current.state == "exporting"
    assert current.attempts == 1
    assert current.export_started_at is not None
    assert current.export_started_at + timedelta(seconds=30) < clock[0]
    clock[0] += timedelta(seconds=11)
    assert claim(case) is None
    expired = _stored(case)
    assert expired.state == "uncertain"
    assert expired.error_code == "export_lease_expired"
    assert expired.export_token == token
    assert not case.repository.renew_export_lease(case.run.id, token)


def test_old_rows_without_heartbeat_use_started_at(case: Collection) -> None:
    leased = claim(case)
    assert leased is not None
    with case.sessions.begin() as session:
        row = session.get(ApplicationTraceRun, case.run.id)
        assert row is not None
        row.export_started_at = naive_utc_now() - timedelta(seconds=60)
        row.export_heartbeat_at = None
    assert claim(case) is None
    current = _stored(case)
    assert current.state == "uncertain"
    assert current.export_token == leased[1]


def test_wrong_token_cannot_renew_or_complete(case: Collection) -> None:
    leased = claim(case)
    assert leased is not None
    before = _stored(case)
    assert not case.repository.renew_export_lease(case.run.id, "other-token")
    case.repository.complete(case.run.id, "other-token", state="accepted", result=TraceExportResult("wrong"))
    current = _stored(case)
    assert current.export_token == leased[1]
    assert current.export_heartbeat_at == before.export_heartbeat_at
    assert current.state == "exporting"
    assert current.provider_trace_id is None


def test_late_success_wins_before_manual_retry_and_is_idempotent(case: Collection) -> None:
    token = _expire(case)
    result = TraceExportResult("confirmed", "https://example.com/trace")
    case.repository.complete(case.run.id, token, state="accepted", result=result)
    current = _stored(case)
    assert current.state == "accepted"
    assert current.error_code is None
    assert current.export_token is None
    assert current.accepted_at is not None
    assert current.trace_url == result.trace_url
    case.repository.complete(case.run.id, token, state="accepted", result=TraceExportResult("duplicate-ack"))
    assert _stored(case).provider_trace_id == "confirmed"
    with pytest.raises(TraceCollectionError, match="tracing_already_accepted"):
        case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)


def test_manual_retry_revokes_old_heartbeat_and_ack_before_and_after_new_claim(case: Collection) -> None:
    old_token = _expire(case)
    case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
    assert not case.repository.renew_export_lease(case.run.id, old_token)
    case.repository.complete(case.run.id, old_token, state="accepted", result=TraceExportResult("old"))
    assert _stored(case).state == "ready"
    second = claim(case)
    assert second is not None
    assert second[1] != old_token
    case.repository.complete(case.run.id, old_token, state="accepted", result=TraceExportResult("old"))
    current = _stored(case)
    assert current.state == "exporting"
    assert current.export_token == second[1]
    assert current.provider_trace_id is None
    case.repository.complete(case.run.id, second[1], state="accepted", result=TraceExportResult("new"))
    assert _stored(case).provider_trace_id == "new"


@pytest.mark.parametrize("late_state", ["failed", "retrying", "uncertain"])
def test_late_non_success_cannot_overwrite_lease_expiry(case: Collection, late_state: str) -> None:
    token = _expire(case)
    case.repository.complete(case.run.id, token, state=late_state, error_code="late-failure")
    current = _stored(case)
    assert current.state == "uncertain"
    assert current.error_code == "export_lease_expired"


def test_other_uncertain_reason_cannot_be_promoted_by_late_ack(case: Collection) -> None:
    token = _expire(case)
    with case.sessions.begin() as session:
        row = session.get(ApplicationTraceRun, case.run.id)
        assert row is not None
        row.error_code = "provider_acceptance_unknown"
    case.repository.complete(case.run.id, token, state="accepted", result=TraceExportResult("late"))
    assert _stored(case).state == "uncertain"


@pytest.mark.parametrize("transient_failure", [False, True])
@pytest.mark.parametrize("outcome", ["accepted", "uncertain"])
def test_service_heartbeats_during_export_and_stops_on_every_outcome(
    case: Collection,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    transient_failure: bool,
    outcome: str,
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_EXPORT_LEASE_SECONDS=1)
    clock = [naive_utc_now()]
    monkeypatch.setattr(repository_module, "naive_utc_now", lambda: clock[0])
    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    renewed = threading.Event()
    calls = []
    original = case.repository.renew_export_lease

    def renew(run_id: str, token: str) -> bool:
        calls.append(threading.get_ident())
        if transient_failure and len(calls) == 1:
            raise RuntimeError("private-provider-value")
        result = original(run_id, token)
        renewed.set()
        return result

    monkeypatch.setattr(case.repository, "renew_export_lease", renew)

    def export(*_args: object) -> TraceExportResult:
        # The original start time is now beyond the lease; only a real background
        # transaction can prevent a second claimant from marking it uncertain.
        clock[0] += timedelta(seconds=3)
        assert renewed.wait(3), "background heartbeat did not commit"
        assert case.repository.claim(case.run.id, collection_timeout=60, lease_seconds=1) is None
        assert _stored(case).state == "exporting"
        if outcome == "uncertain":
            raise TraceExportUncertainError("lost acknowledgement")
        return TraceExportResult("ack")

    monkeypatch.setattr(service_module, "export_trace", export)
    ApplicationTracingService(case.repository).deliver(case.run.id)
    assert _stored(case).state == outcome
    assert calls
    assert all(thread_id != threading.get_ident() for thread_id in calls)
    assert not any(thread.name == f"application-trace-lease-{case.run.id}" for thread in threading.enumerate())
    assert "private-provider-value" not in caplog.text


def test_heartbeat_stops_even_when_completion_database_write_raises(
    case: Collection, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    monkeypatch.setattr(service_module, "export_trace", lambda *_args: TraceExportResult("ack"))

    def fail_complete(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(case.repository, "complete", fail_complete)
    with pytest.raises(RuntimeError, match="database unavailable"):
        ApplicationTracingService(case.repository).deliver(case.run.id)
    assert not any(thread.name == f"application-trace-lease-{case.run.id}" for thread in threading.enumerate())
