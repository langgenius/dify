"""Exercise public orchestration, privacy, and delivery decisions against durable rows."""

from datetime import datetime
from uuid import UUID

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.ops.exceptions import RetryableTraceDispatchError
from graphon.enums import WorkflowNodeExecutionStatus
from models.application_trace import ApplicationTraceRun
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.application_trace_repository import TraceCollectionError
from services.tracing import service as service_module
from services.tracing.provider_dispatch import TraceExportResult
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_workflow
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    batch_for,
    claim,
    identifier,
    ingest,
    seed,
    terminal,
)


def source(case: Collection) -> dict[str, str]:
    return {
        "tenant_id": case.run.tenant_id,
        "app_id": case.run.app_id,
        "source_kind": "message",
        "source_id": case.run.source_id,
    }


def test_prepare_invocation_returns_only_opaque_context_and_respects_capture_gate(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    case = seed(sqlite_session_factory, "prepare", capture_content=True)
    service = ApplicationTracingService(case.repository)
    context = service.prepare_invocation(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        agent_id=identifier("agent"),
        source_kind="message",
        source_id=case.run.source_id,
        session_id="ignored-new-session",
        node_execution_id=None,
        attempt=0,
        call_key="call",
    )
    assert context is not None
    assert context.run_id == UUID(case.run.id)
    assert context.capture_content is True
    assert context.session_id == "session-original"
    assert "encrypted-original" not in context.model_dump_json()
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
    assert (
        service.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
            session_id="new",
        )
        is None
    )


@pytest.mark.parametrize("missing", ["tenant", "app", "message"])
def test_status_denies_foreign_or_absent_source_without_destination_details(
    sqlite_session_factory: sessionmaker[Session], missing: str
) -> None:
    case = seed(sqlite_session_factory, "scope")
    identity = source(case)
    identity[{"tenant": "tenant_id", "app": "app_id", "message": "source_id"}[missing]] = identifier("foreign")
    with pytest.raises(TraceCollectionError) as caught:
        ApplicationTracingService(case.repository).status(**identity)
    assert caught.value.code == "tracing_source_not_found"
    assert caught.value.status == 404
    assert "encrypted-original" not in str(caught.value)


def test_status_uses_frozen_destination_and_selects_latest_node_attempt(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    case = seed(sqlite_session_factory, "status")
    node_id = identifier("selected-node")
    invocation = case.repository.invocation(
        run_id=case.run.id, agent_id=identifier("agent"), node_execution_id=node_id, attempt=1, call_key="node:1"
    )
    ingest(case, batch_for(case.run, invocation))
    terminal(case)
    lease = claim(case)
    assert lease is not None
    case.repository.complete(
        case.run.id,
        lease[1],
        state="accepted",
        result=TraceExportResult(
            "provider-trace",
            trace_url="https://frozen.example/trace",
            span_urls={invocation.span_id: "https://frozen.example/span"},
        ),
    )
    service = ApplicationTracingService(case.repository)
    result = service.status(**source(case), node_execution_id=node_id)
    assert result["status"] == "accepted"
    assert result["trace_id"] == "provider-trace"
    assert result["span_url"] == "https://frozen.example/span"
    assert result["config_revision"] == case.run.config_revision
    assert result["queryable"] is None
    assert result["capture_content"] is False
    assert "provider_config" not in result
    assert "encrypted-original" not in str(result)
    with pytest.raises(TraceCollectionError, match="tracing_node_not_found"):
        service.status(**source(case), node_execution_id=identifier("another-node"))


@pytest.mark.parametrize("disabled", [True, False])
def test_uncollected_status_and_missing_run_retry_do_not_construct_provider(
    sqlite_session_factory: sessionmaker[Session], disabled: bool
) -> None:
    case = seed(sqlite_session_factory, "missing", enabled=not disabled)
    if not disabled:
        with case.sessions.begin() as session:
            stored = session.get(ApplicationTraceRun, case.run.id)
            assert stored is not None
            session.delete(stored)
    service = ApplicationTracingService(case.repository)
    assert service.status(**source(case)) == {
        "status": "not_collected",
        "source_kind": "message",
        "source_id": case.run.source_id,
    }
    if not disabled:
        with pytest.raises(TraceCollectionError, match="tracing_run_not_found"):
            service.retry(**source(case), acknowledge_possible_duplicates=True)


def test_retry_acknowledgement_guards_schedule_and_keeps_frozen_snapshot(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = seed(sqlite_session_factory, "retry")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    lease = claim(case)
    assert lease is not None
    case.repository.complete(case.run.id, lease[1], state="uncertain", error_code="provider_acceptance_unknown")
    scheduled: list[str] = []
    service = ApplicationTracingService(case.repository)
    monkeypatch.setattr(service, "schedule", scheduled.append)
    with pytest.raises(TraceCollectionError, match="tracing_duplicate_acknowledgement_required"):
        service.retry(**source(case), acknowledge_possible_duplicates=False)
    assert scheduled == []
    result = service.retry(**source(case), acknowledge_possible_duplicates=True)
    assert scheduled == [case.run.id]
    assert result["status"] == "ready"
    assert result["config_revision"] == case.run.config_revision
    current = case.repository.get(case.run.id)
    assert current is not None
    assert current.provider_config == case.run.provider_config


@pytest.mark.parametrize(
    ("failure", "code"),
    [
        (RetryableTraceDispatchError("private-transport-error"), "provider_retry_exhausted"),
        (ValueError("private-credential-error"), "provider_export_rejected"),
    ],
)
def test_delivery_exhaustion_and_rejection_never_log_vendor_details(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    failure: Exception,
    code: str,
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_MAX_ATTEMPTS=1)
    case = seed(sqlite_session_factory, "delivery")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)

    def export(*_args: object) -> TraceExportResult:
        raise failure

    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    monkeypatch.setattr(service_module, "export_trace", export)
    service = ApplicationTracingService(case.repository)
    service.deliver(case.run.id)
    current = case.repository.get(case.run.id)
    assert current is not None
    assert current.state == "failed"
    assert current.error_code == code
    assert "private-" not in caplog.text
    service.deliver(identifier("missing-run"))


@pytest.mark.parametrize("capture_content", [False, True])
@pytest.mark.parametrize(
    "status",
    [WorkflowNodeExecutionStatus.RUNNING, WorkflowNodeExecutionStatus.SUCCEEDED, WorkflowNodeExecutionStatus.FAILED],
)
def test_preview_terminal_uses_persisted_node_state_and_frozen_privacy(
    sqlite_session_factory: sessionmaker[Session], status: WorkflowNodeExecutionStatus, capture_content: bool
) -> None:
    case = seed(sqlite_session_factory, "preview", capture_content=capture_content)
    node_id = identifier("preview-node")
    workflow_id = identifier("preview-definition")
    with case.sessions.begin() as session:
        session.add(make_workflow(workflow_id=workflow_id, tenant_id=case.run.tenant_id, app_id=case.run.app_id))
        session.add(
            WorkflowNodeExecutionModel(
                id=node_id,
                node_execution_id=node_id,
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                workflow_id=workflow_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
                index=0,
                node_id="agent",
                node_type="agent",
                title="Agent preview",
                inputs='{"secret":"private-input"}',
                outputs='{"answer":"private-output"}',
                process_data="{}",
                status=status,
                elapsed_time=2,
                error="private-model-error" if status == WorkflowNodeExecutionStatus.FAILED else None,
                created_at=datetime(2026, 1, 1),
                created_by=identifier("account"),
                created_by_role=CreatorUserRole.ACCOUNT,
            )
        )
    run = case.repository.start(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="node",
        source_id=node_id,
        workflow_id=workflow_id,
        session_id="preview-session",
    )
    assert run is not None
    ApplicationTracingService(case.repository).settle_preview(run)
    current = case.repository.get(run.id)
    assert current is not None
    if status == WorkflowNodeExecutionStatus.RUNNING:
        assert current.outer_trace is None
    else:
        assert current.outer_trace is not None
        trace = service_module.CanonicalTrace.model_validate(current.outer_trace)
        root = trace.spans[0]
        assert root.status.value == ("error" if status == WorkflowNodeExecutionStatus.FAILED else "ok")
        assert ("private-" in trace.model_dump_json()) is capture_content
        assert root.metadata["node_execution_id"] == node_id
        if not capture_content and status == WorkflowNodeExecutionStatus.FAILED:
            assert root.error == "Node execution failed"


@pytest.mark.parametrize("owner_state", ["no_creator", "missing_account", "wrong_app"])
def test_missing_owner_identity_cannot_authorize_trace_expansion(
    sqlite_session_factory: sessionmaker[Session], owner_state: str
) -> None:
    from models.model import App

    case = seed(sqlite_session_factory, "owner")
    with case.sessions.begin() as session:
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.created_by = None if owner_state == "no_creator" else identifier("missing-owner")
    app_id = identifier("another-app") if owner_state == "wrong_app" else case.run.app_id
    with pytest.raises(TraceCollectionError, match="tracing_owner_not_found"):
        ApplicationTracingService(case.repository)._service_account(case.run, app_id)


@pytest.mark.parametrize(
    ("invalid", "code"),
    [
        ("empty", "tracing_invocation_empty"),
        ("foreign_parent", "tracing_invocation_parent_invalid"),
        ("no_invocation_root", "tracing_invocation_root_missing"),
        ("conflicting_span", "tracing_span_conflict"),
    ],
)
def test_invalid_runtime_tree_is_rejected_before_provider_credentials_or_io(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, invalid: str, code: str
) -> None:
    case = seed(sqlite_session_factory, "invalid-runtime")
    batch = batch_for(case.run, case.invocation())
    if invalid == "empty":
        batch.spans = []
    elif invalid == "foreign_parent":
        batch.spans[0] = batch.spans[0].model_copy(update={"parent_span_id": "f" * 16})
    elif invalid == "no_invocation_root":
        batch.spans[0] = batch.spans[0].model_copy(update={"parent_span_id": batch.spans[0].span_id})
    else:
        ingest(case, batch.model_copy(update={"final": False}))
        from uuid import uuid4

        batch = batch.model_copy(
            update={"batch_id": uuid4(), "spans": [batch.spans[0].model_copy(update={"name": "conflicting-version"})]}
        )
    ingest(case, batch)
    terminal(case)

    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("invalid trees must fail before credentials or provider requests")

    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", forbidden)
    monkeypatch.setattr(service_module, "export_trace", forbidden)
    service = ApplicationTracingService(case.repository)
    service.deliver(case.run.id)
    current = case.repository.get(case.run.id)
    assert current is not None
    assert current.state == "failed"
    assert current.error_code == code


def test_assemble_requires_a_persisted_business_terminal(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "no-terminal")
    with pytest.raises(TraceCollectionError, match="tracing_terminal_missing"):
        ApplicationTracingService(case.repository).assemble(case.run)
