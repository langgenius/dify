"""Persistence boundaries that must fail closed or remain immutable across retries."""

from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.model import App
from repositories.application_trace_repository import TraceCollectionError
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    batch_for,
    claim,
    identifier,
    ingest,
    seed,
    terminal,
)


@pytest.mark.parametrize("policy", ["invalid-json", "null", "[]"])
def test_malformed_policy_freezes_disabled_decision(sqlite_session_factory: sessionmaker[Session], policy: str) -> None:
    case = seed(sqlite_session_factory, "malformed")
    with case.sessions.begin() as session:
        session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == case.run.id))
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.tracing = policy
    run = case.repository.start(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="message",
        source_id=case.run.source_id,
        session_id="",
    )
    assert run is not None
    assert run.state == "not_collected"
    assert run.provider_config == {}
    assert run.session_id == case.run.source_id
    assert not run.capture_content
    assert not run.capture_agent


def test_reserved_preview_requires_persisted_owner_workflow(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "missing-preview-owner")
    assert (
        case.repository.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="node",
            source_id=identifier("preview"),
            session_id="preview",
            workflow_id=identifier("missing-workflow"),
        )
        is None
    )


def test_initialization_failure_cannot_replace_snapshot_or_create_foreign_row(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    case = seed(sqlite_session_factory, "failure-snapshot")
    same = case.repository.record_initialization_failure(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="message",
        source_id=case.run.source_id,
    )
    assert same is not None
    assert same.id == case.run.id
    assert same.state == "collecting"
    assert same.provider_config == case.run.provider_config
    assert (
        case.repository.record_initialization_failure(
            tenant_id=identifier("foreign-tenant"),
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
        )
        is None
    )


@pytest.mark.parametrize("target", ["missing_run", "revoked_owner", "closed_invocation"])
def test_ingestion_rejects_missing_or_closed_owner_without_writing(
    sqlite_session_factory: sessionmaker[Session], target: str
) -> None:
    case = seed(sqlite_session_factory, "ingestion-owner")
    invocation = case.invocation()
    batch = batch_for(case.run, invocation)
    if target == "missing_run":
        batch = batch.model_copy(update={"run_id": UUID(identifier("missing-run"))})
        error = "tracing_run_not_found"
    elif target == "revoked_owner":
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.tenant_id = identifier("another-tenant")
        error = "tracing_owner_not_found"
    else:
        with case.sessions.begin() as session:
            stored = session.get(ApplicationTraceInvocation, invocation.id)
            assert stored is not None
            stored.finalized = True
        error = "tracing_collection_closed"
    with pytest.raises(TraceCollectionError, match=error):
        ingest(case, batch)
    with case.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 0
    stored_run = case.repository.get(case.run.id)
    assert stored_run is not None
    assert stored_run.span_count == 0


def test_first_terminal_is_immutable_and_revoked_owner_is_never_exported(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    case = seed(sqlite_session_factory, "terminal-owner")
    terminal(case)
    before = case.repository.get(case.run.id)
    assert before is not None
    case.repository.terminal(case.run.id, {"replacement": True}, "f" * 16)
    after = case.repository.get(case.run.id)
    assert after is not None
    assert after.outer_trace == before.outer_trace
    assert after.root_span_id == before.root_span_id
    with case.sessions.begin() as session:
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.tenant_id = identifier("moved-owner")
    assert claim(case) is None
    failed = case.repository.get(case.run.id)
    assert failed is not None
    assert failed.error_code == "tracing_owner_not_found"
    assert failed.state == "failed"
    case.repository.terminal(case.run.id, {"replacement": True}, "f" * 16)
    frozen = case.repository.get(case.run.id)
    assert frozen is not None
    assert frozen.outer_trace == before.outer_trace


@pytest.mark.parametrize(
    ("state", "error"),
    [
        ("not_collected", "tracing_run_not_found"),
        ("accepted", "tracing_already_accepted"),
        ("collecting", "tracing_retry_not_allowed"),
    ],
)
def test_retry_rejects_ineligible_states(sqlite_session_factory: sessionmaker[Session], state: str, error: str) -> None:
    case = seed(sqlite_session_factory, "retry-state")
    terminal(case)
    with case.sessions.begin() as session:
        row = session.get(ApplicationTraceRun, case.run.id)
        assert row is not None
        row.state = state
    with pytest.raises(TraceCollectionError, match=error):
        case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
    row = case.repository.get(case.run.id)
    assert row is not None
    assert row.state == state


def test_retry_unknown_run_and_invocation_reject_before_creation(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "retry-unknown")
    with pytest.raises(TraceCollectionError, match="tracing_run_not_found"):
        case.repository.retry(run_id=identifier("missing"), acknowledge_possible_duplicates=True)
    with pytest.raises(TraceCollectionError, match="tracing_run_not_collecting"):
        case.repository.invocation(
            run_id=identifier("missing"),
            agent_id=identifier("agent"),
            node_execution_id=None,
            attempt=0,
            call_key="x",
        )
    assert case.repository.claim(identifier("missing"), collection_timeout=1, lease_seconds=1) is None


def test_collection_without_terminal_is_not_exportable(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "no-terminal")
    ingest(case, batch_for(case.run, case.invocation()))
    assert claim(case) is None
    row = case.repository.get(case.run.id)
    assert row is not None
    assert row.attempts == 0
    assert row.state == "collecting"


def test_retention_removes_all_payload_rows_and_preserves_newer_runs(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    expired = seed(sqlite_session_factory, "expired")
    fresh = seed(sqlite_session_factory, "fresh")
    for case in (expired, fresh):
        ingest(case, batch_for(case.run, case.invocation()))
    with expired.sessions.begin() as session:
        row = session.get(ApplicationTraceRun, expired.run.id)
        assert row is not None
        row.created_at = naive_utc_now() - timedelta(days=8)
    assert expired.repository.purge(retention_days=7) == 1
    assert expired.repository.get(expired.run.id) is None
    assert expired.repository.collected(expired.run.id) == ([], [])
    assert fresh.repository.get(fresh.run.id) is not None
    invocations, batches = fresh.repository.collected(fresh.run.id)
    assert len(invocations) == len(batches) == 1
    assert expired.repository.purge(retention_days=7) == 0
