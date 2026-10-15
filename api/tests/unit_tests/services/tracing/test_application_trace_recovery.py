"""Recover lost terminal notifications using real business rows and TraceTask."""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from core.ops.ops_trace_manager import TraceTask
from core.ops.unified_trace.entities import CanonicalTrace
from extensions.ext_database import db
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceInvocation
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Message
from models.workflow import WorkflowRun, WorkflowType
from services.tracing import recovery
from services.tracing import service as service_module
from services.tracing.normalization import span_id
from services.tracing.provider_dispatch import TraceExportResult
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.model_factories import make_account, make_conversation
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    batch_for,
    identifier,
    ingest,
    seed,
)


@dataclass
class RecoveryCase:
    collection: Collection
    service: ApplicationTracingService
    now: datetime
    scheduled: list[str]


def attach_conversation(case: Collection) -> None:
    with case.sessions.begin() as session:
        message = session.get(Message, case.run.source_id)
        assert message is not None
        session.add(
            make_conversation(
                conversation_id=message.conversation_id,
                app_id=case.run.app_id,
                mode=AppMode.AGENT,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )


@pytest.fixture
def case(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> RecoveryCase:
    collection = seed(sqlite_session_factory, "recover", capture_content=True)
    attach_conversation(collection)
    invocation = collection.invocation()
    ingest(collection, batch_for(collection.run, invocation))
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        message = session.get(Message, collection.run.source_id)
        assert message is not None
        stored_invocation = session.get(ApplicationTraceInvocation, invocation.id)
        assert message is not None
        assert stored_invocation is not None
        message.created_at = now - timedelta(seconds=30)
        message.updated_at = now - timedelta(seconds=10)
        message.answer = "persisted final answer"
        message.provider_response_latency = 1.0
        message.message_tokens = 2
        message.answer_tokens = 1
        stored_invocation.finalized_at = now - timedelta(seconds=10)
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_engine))
    monkeypatch.setattr(db, "session", scoped_session(sqlite_session_factory))
    monkeypatch.setattr(TraceTask, "_workflow_run_repo", None)
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)
    monkeypatch.setattr(recovery, "naive_utc_now", lambda: now)
    service = ApplicationTracingService(collection.repository)
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    return RecoveryCase(collection, service, now, scheduled)


def complete_metadata() -> str:
    return json.dumps(
        {
            "annotation_reply": None,
            "retriever_resources": [],
            "reasoning": {},
            "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
        }
    )


@pytest.mark.parametrize("outcome", ["succeeded", "cancelled", "failed"])
def test_worker_terminal_survives_closed_sse_without_inventing_a_message_write(
    case: RecoveryCase, outcome: Literal["succeeded", "failed", "cancelled"]
) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = json.dumps({"usage": {"prompt_tokens": 2, "completion_tokens": 1}})
        message.answer = ""
    # A runtime final/usage flush still does not imply that an API message ended.
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    output = "actual worker result" if outcome == "succeeded" else None
    case.service.capture_agent_app_terminal(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        message_id=case.collection.run.source_id,
        outcome=outcome,
        output=output,
    )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    trace = CanonicalTrace.model_validate(stored.outer_trace)
    root = trace.spans[0]
    assert root.metadata["message_execution_state"] == outcome
    assert root.status.value == ("ok" if outcome == "succeeded" else "error")
    assert root.outputs == (output or "")
    assert case.scheduled == [stored.id]
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert message.answer == ""
        assert message.message_metadata is not None
        assert set(json.loads(message.message_metadata)) == {"usage"}


def test_worker_terminal_revalidates_message_tenant(case: RecoveryCase) -> None:
    from repositories.application_trace_repository import TraceCollectionError

    with pytest.raises(TraceCollectionError, match="tracing_source_not_found"):
        case.service.capture_agent_app_terminal(
            tenant_id=identifier("foreign-tenant"),
            app_id=case.collection.run.app_id,
            message_id=case.collection.run.source_id,
            outcome="succeeded",
            output="must not export",
        )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is None


def test_recovers_real_message_terminal_once_through_existing_trace_task(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=11)
    assert recovery.recover_terminal(case.service, case.collection.run) is True
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is not None
    assert stored.outer_trace["session_id"] == "session-original"
    assert stored.outer_trace["spans"][0]["outputs"] == "persisted final answer"
    assert recovery.recover_terminal(case.service, stored) is False
    assert case.scheduled == [stored.id]
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert message.message_tokens == 2
        assert message.answer_tokens == 1
        assert message.answer == "persisted final answer"


def test_deliver_recovers_and_exports_once_after_terminal_queue_loss(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=11)
    exported: list[CanonicalTrace] = []

    def export(_provider: str, _config: dict[str, object], trace: CanonicalTrace) -> TraceExportResult:
        exported.append(trace)
        return TraceExportResult(trace_id="provider-id")

    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    monkeypatch.setattr(service_module, "export_trace", export)
    case.service.deliver(case.collection.run.id)
    case.service.deliver(case.collection.run.id)
    assert len(exported) == 1
    assert exported[0].spans[0].outputs == "persisted final answer"
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "accepted"
    assert stored.attempts == 1


def test_early_usage_commit_is_not_treated_as_a_final_answer(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = json.dumps({"usage": {"prompt_tokens": 2, "completion_tokens": 1}})
        message.answer = ""
        message.updated_at = case.now - timedelta(seconds=11)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is None
    assert stored.state == "collecting"
    assert not case.scheduled


def test_final_without_business_commit_times_out_as_failed_not_success(case: RecoveryCase) -> None:
    invocations, _ = case.collection.repository.collected(case.collection.run.id)
    with case.collection.sessions.begin() as session:
        invocation = session.get(ApplicationTraceInvocation, invocations[0].id)
        assert invocation is not None
        invocation.finalized_at = case.now - timedelta(hours=1)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "failed"
    assert stored.error_code == "business_terminal_not_persisted"
    assert stored.outer_trace is None


def test_final_settle_window_and_all_invocations_must_finish(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=1)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    second = case.collection.invocation("pending-second")
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.updated_at = case.now - timedelta(seconds=10)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    with case.collection.sessions() as session:
        invocation = session.get(ApplicationTraceInvocation, second.id)
        assert invocation is not None
        assert invocation.finalized is False


def test_explicit_message_failure_can_recover_without_fabricating_usage(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.status = MessageStatus.ERROR
        message.error = "model initialization failed"
        message.answer = ""
        message.message_metadata = None
        message.message_tokens = 0
        message.answer_tokens = 0
        message.updated_at = case.now - timedelta(seconds=11)
    assert recovery.recover_terminal(case.service, case.collection.run) is True
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is not None
    assert stored.outer_trace["spans"][0]["status"] == "error"
    assert stored.outer_trace["spans"][0]["outputs"] == ""
    assert stored.outer_trace["spans"][0]["metadata"]["aggregate_total_tokens"] == 0


def test_cross_tenant_source_is_rejected_before_trace_task_executes(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    with case.collection.sessions.begin() as session:
        app = session.get(App, case.collection.run.app_id)
        assert app is not None
        app.tenant_id = identifier("other-tenant")
    called: list[bool] = []

    def forbidden(_task: TraceTask) -> None:
        called.append(True)

    monkeypatch.setattr(TraceTask, "execute", forbidden)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert called == []
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.error_code == "tracing_source_not_found"


def test_unresolved_recovery_rotates_behind_unchecked_sources(case: RecoveryCase) -> None:
    other = seed(case.collection.sessions, "other-recovery")
    assert case.collection.repository.pending_ids(limit=1) == [case.collection.run.id]
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert case.collection.repository.pending_ids(limit=1) == [other.run.id]
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "collecting"


@pytest.mark.parametrize("status", [MessageStatus.PAUSED, MessageStatus.NORMAL])
def test_no_final_marker_or_paused_message_is_not_recovered(case: RecoveryCase, status: MessageStatus) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.status = status
        message.updated_at = case.now - timedelta(seconds=10)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert not case.scheduled


@pytest.mark.parametrize(
    ("status", "finished"),
    [
        (WorkflowExecutionStatus.RUNNING, False),
        (WorkflowExecutionStatus.PAUSED, True),
        (WorkflowExecutionStatus.SUCCEEDED, False),
        (WorkflowExecutionStatus.SUCCEEDED, True),
        (WorkflowExecutionStatus.PARTIAL_SUCCEEDED, True),
        (WorkflowExecutionStatus.FAILED, True),
        (WorkflowExecutionStatus.STOPPED, True),
    ],
)
def test_workflow_recovery_requires_committed_terminal_state(
    case: RecoveryCase, status: WorkflowExecutionStatus, finished: bool
) -> None:
    owner_id, workflow_run_id = identifier("workflow-owner"), identifier("recover-workflow-run")
    with case.collection.sessions.begin() as session:
        app = session.get(App, case.collection.run.app_id)
        assert app is not None
        app.created_by = owner_id
        session.add(make_account(account_id=owner_id))
        session.add(
            WorkflowRun(
                id=workflow_run_id,
                tenant_id=case.collection.run.tenant_id,
                app_id=app.id,
                workflow_id=identifier("workflow"),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="1",
                graph="{}",
                inputs="{}",
                outputs=json.dumps({"result": "persisted workflow output"}),
                status=status,
                error="actual workflow failure"
                if status in {WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.STOPPED}
                else None,
                created_by=owner_id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_at=case.now - timedelta(seconds=30),
                finished_at=case.now - timedelta(seconds=10) if finished else None,
                elapsed_time=20,
                total_tokens=0,
                total_steps=0,
            )
        )
    run = case.collection.repository.start(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        source_kind="workflow",
        source_id=workflow_run_id,
        session_id="workflow-session",
    )
    assert run is not None
    expected = finished and status in {
        WorkflowExecutionStatus.SUCCEEDED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.STOPPED,
    }
    assert recovery.recover_terminal(case.service, run) is expected
    stored = case.collection.repository.get(run.id)
    assert stored is not None
    if expected:
        assert stored.outer_trace is not None
        assert stored.outer_trace["root_span_id"] == span_id(workflow_run_id)
        assert stored.outer_trace["spans"][0]["outputs"] == {"result": "persisted workflow output"}
    else:
        assert stored.outer_trace is None
