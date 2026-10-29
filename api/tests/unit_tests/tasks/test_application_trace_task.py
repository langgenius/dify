"""Exercise Celery entrypoints against durable application trace state."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from core.helper import ssrf_proxy
from domain.tracing.trace_run_agg import TraceRunState
from extensions.application_services.tracing import build_tracing_services
from extensions.ext_application_services import ApplicationServices
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceRun
from models.enums import ConversationFromSource
from models.model import AppMode, Message
from repositories.factory import DifyAPIRepositoryFactory
from repositories.trace_record_repository import TraceRecordRepository
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.collection import AgentTraceSettings
from services.tracing.egress import SSRFEgress
from services.tracing.providers import ProviderConfigCodec
from services.tracing.records import MessageTraceInfo
from services.tracing.registry import EntryPointTraceProviderCatalog
from services.tracing.service import ApplicationTracingService
from tasks.application_trace_task import export_application_trace, reconcile_application_traces
from tests.helpers.unit.model_factories import make_conversation, make_tenant
from tests.helpers.unit.services.tracing_ports import AGENT_TRACE_SETTINGS, WorkspaceBoundCipher
from tests.unit_tests.repositories.test_application_trace_repository import (
    Collection,
    batch_for,
    ingest,
    seed,
    terminal,
)


def bind_worker(
    app: Flask,
    services: ApplicationServices,
    collection: Collection,
    *,
    settings: AgentTraceSettings,
    scheduled: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hand the tasks a worker over the seeded ledger with the installed providers and the SSRF egress."""
    worker = ApplicationTracingService(
        runs=collection.repository,
        run_query=collection.repository,
        sources=collection.repository,
        records=TraceRecordRepository(
            collection.sessions,
            workflow_runs=DifyAPIRepositoryFactory.create_api_workflow_run_repository(collection.sessions),
            node_executions=DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(collection.sessions),
            files_url="https://files.test",
            enterprise_details=False,
        ),
        builder=CanonicalTraceBuilder(),
        providers=EntryPointTraceProviderCatalog(),
        codec=ProviderConfigCodec(WorkspaceBoundCipher()),
        egress=SSRFEgress(),
        schedule_export=scheduled.append,
        settings=settings,
    )
    monkeypatch.setitem(
        app.extensions,
        "application_services",
        replace(services, tracing=replace(services.tracing, agent_traces=worker)),
    )


def test_worker_task_exports_once_through_the_ssrf_proxy_and_replay_observes_checkpoint(
    app: Flask,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = seed(sqlite_session_factory, "worker-task")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    bind_worker(
        app,
        account_application_services,
        case,
        settings=AGENT_TRACE_SETTINGS,
        scheduled=[],
        monkeypatch=monkeypatch,
    )
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
    assert result.state is TraceRunState.ACCEPTED
    assert result.attempts == 1
    provider_trace_id = str(UUID(hex=case.run.trace_id))
    assert result.provider_trace_id == provider_trace_id
    assert result.trace_url == f"https://langfuse.test/project/original/traces/{provider_trace_id}"


def test_worker_records_carry_no_enterprise_names(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "worker-names")
    with case.sessions.begin() as session:
        message = session.get(Message, case.run.source_id)
        assert message is not None
        conversation_id = message.conversation_id
        session.add(
            make_conversation(
                conversation_id=conversation_id,
                app_id=case.run.app_id,
                mode=AppMode.AGENT,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )
        session.add(make_tenant(tenant_id=case.run.tenant_id))
    # The tasks reach this Agent trace service through the composition root; its records feed recovery.
    worker = build_tracing_services(database_client=sqlite_session_factory).agent_traces
    record = worker._records.assemble(
        TraceEvent(
            event_id=uuid4().hex,
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            user_id=None,
            occurred_at=datetime.now(UTC),
            correlation=TraceCorrelation(
                external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
            ),
            payload=MessageCompleted(message_id=case.run.source_id, conversation_id=conversation_id),
        )
    )
    assert isinstance(record, MessageTraceInfo)
    assert (record.metadata["app_name"], record.metadata["workspace_name"]) == ("", "")


def test_reconcile_only_schedules_due_pending_rows_and_applies_retention(
    app: Flask,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    due = seed(sqlite_session_factory, "due")
    deferred = seed(sqlite_session_factory, "future")
    accepted = seed(sqlite_session_factory, "accepted-expired")
    with sqlite_session_factory.begin() as session:
        future = session.get(ApplicationTraceRun, deferred.run.id)
        expired = session.get(ApplicationTraceRun, accepted.run.id)
        assert future is not None
        assert expired is not None
        future.state = TraceRunState.RETRYING
        future.next_attempt_at = naive_utc_now() + timedelta(hours=1)
        expired.state = TraceRunState.ACCEPTED
        expired.created_at = naive_utc_now() - timedelta(days=4)
    scheduled: list[str] = []
    bind_worker(
        app,
        account_application_services,
        due,
        settings=replace(AGENT_TRACE_SETTINGS, retention_days=3),
        scheduled=scheduled,
        monkeypatch=monkeypatch,
    )
    reconcile_application_traces.run()
    assert scheduled == [due.run.id]
    assert due.repository.get(accepted.run.id) is None
    assert due.repository.get(deferred.run.id) is not None
    assert due.repository.get(due.run.id) is not None
