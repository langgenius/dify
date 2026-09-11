from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import TraceProviderSettings
from core.telemetry.events import AppCreatedEvent, DraftNodeExecutionTraceEvent, PromptGenerationEvent, TelemetryContext
from enterprise.telemetry import operation_trace
from models.account import Tenant
from models.dataset import Pipeline
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType


@pytest.fixture
def operation_owner(
    sqlite_session: Session, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> tuple[Tenant, App]:
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=sqlite_engine))
    tenant = Tenant(name="enterprise operation tenant")
    sqlite_session.add(tenant)
    sqlite_session.flush()
    app = App(tenant_id=tenant.id, name="Workflow app", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    sqlite_session.add(app)
    sqlite_session.commit()
    return tenant, app


def test_enterprise_source_rejects_payload_owner_mismatch_before_recording(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.telemetry.events import DraftNodeExecutionTraceEvent, TelemetryContext

    event = DraftNodeExecutionTraceEvent(
        context=TelemetryContext(tenant_id=str(uuid4()), app_id=str(uuid4())),
        payload={"node_execution_data": {"tenant_id": str(uuid4()), "app_id": str(uuid4())}},
    )
    create = Mock()
    monkeypatch.setattr(operation_trace, "create_message_trace", create)
    with pytest.raises(ValueError, match="owner mismatch"):
        operation_trace.record_enterprise_operation(event)
    create.assert_not_called()


@pytest.mark.parametrize("pipeline_run", [False, True])
def test_draft_operation_authorizes_its_owner_and_only_uses_enterprise_destinations(
    operation_owner: tuple[Tenant, App],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    pipeline_run: bool,
) -> None:
    tenant, app = operation_owner
    owner_id = app.id
    if pipeline_run:
        pipeline = Pipeline(tenant_id=tenant.id, name="Pipeline", description="")
        sqlite_session.add(pipeline)
        sqlite_session.flush()
        owner_id = pipeline.id
    workflow = Workflow(
        tenant_id=tenant.id,
        app_id=owner_id,
        type=WorkflowType.RAG_PIPELINE if pipeline_run else WorkflowType.WORKFLOW,
        version="draft",
        graph="{}",
        _features="{}",
        created_by=str(uuid4()),
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()
    recorder = Mock(spec=MessageTraceRecorder)
    enterprise = TraceProviderSettings(tenant_id=tenant.id, provider_name="enterprise", destination_type="enterprise")
    recorder.provider_settings = (
        TraceProviderSettings(tenant_id=tenant.id, app_id=app.id, config_id=str(uuid4()), provider_name="example"),
        enterprise,
    )
    create = Mock(return_value=recorder)
    monkeypatch.setattr(operation_trace, "create_message_trace", create)
    event = DraftNodeExecutionTraceEvent(
        context=TelemetryContext(tenant_id=tenant.id, app_id=owner_id, user_id=workflow.created_by),
        payload={
            "node_execution_data": {
                "tenant_id": tenant.id,
                "app_id": owner_id,
                "workflow_id": workflow.id,
                "title": "Retrieve",
                "node_type": "knowledge-retrieval",
                "node_inputs": {"query": "question"},
                "node_outputs": {"answer": "result"},
                "prompt_tokens": 2,
            }
        },
    )
    operation_trace.record_enterprise_operation(event)
    create.assert_called_once_with(
        tenant_id=tenant.id,
        app_id=None if pipeline_run else app.id,
        pipeline_id=owner_id if pipeline_run else None,
        user_id=workflow.created_by,
    )
    assert recorder.provider_settings == (enterprise,)
    operation = recorder.record_operation.call_args
    assert operation.args == ("Retrieve",)
    assert operation.kwargs["outputs"] == {"answer": "result"}
    assert operation.kwargs["usage"]["prompt_tokens"] == 2
    assert operation.kwargs["independent"] is True


@pytest.mark.parametrize("missing", ["workflow", "app", "pipeline"])
def test_draft_operation_rejects_missing_persisted_owners(
    operation_owner: tuple[Tenant, App],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    missing: str,
) -> None:
    tenant, _ = operation_owner
    owner_id, workflow_id = str(uuid4()), str(uuid4())
    if missing != "workflow":
        sqlite_session.add(
            Workflow(
                id=workflow_id,
                tenant_id=tenant.id,
                app_id=owner_id,
                type=WorkflowType.RAG_PIPELINE if missing == "pipeline" else WorkflowType.WORKFLOW,
                version="draft",
                graph="{}",
                _features="{}",
                created_by=str(uuid4()),
            )
        )
        sqlite_session.commit()
    create = Mock()
    monkeypatch.setattr(operation_trace, "create_message_trace", create)
    event = DraftNodeExecutionTraceEvent(
        context=TelemetryContext(tenant_id=tenant.id, app_id=owner_id),
        payload={"node_execution_data": {"tenant_id": tenant.id, "app_id": owner_id, "workflow_id": workflow_id}},
    )
    with pytest.raises(ValueError, match=f"Trace {missing} not found"):
        operation_trace.record_enterprise_operation(event)
    create.assert_not_called()


def test_prompt_trace_requires_matching_owner_and_handles_disabled_recording(monkeypatch: pytest.MonkeyPatch) -> None:
    tenant_id, app_id = str(uuid4()), str(uuid4())
    event = PromptGenerationEvent(
        context=TelemetryContext(tenant_id=tenant_id, app_id=app_id),
        payload={
            "tenant_id": tenant_id,
            "app_id": app_id,
            "operation_type": "prompt_generation",
            "instruction": "Write a prompt",
            "generated_output": "Generated prompt",
            "model_provider": "provider",
            "model_name": "model",
            "prompt_tokens": 2,
            "completion_tokens": 3,
            "total_tokens": 5,
            "latency": 0.5,
        },
    )
    recorder = Mock(spec=MessageTraceRecorder)
    recorder.provider_settings = ()
    create = Mock(return_value=recorder)
    monkeypatch.setattr(operation_trace, "create_message_trace", create)
    operation_trace.record_enterprise_operation(event)
    assert recorder.record_operation.call_args.kwargs["outputs"] == "Generated prompt"
    assert recorder.record_operation.call_args.kwargs["usage"]["total_tokens"] == 5
    create.return_value = None
    operation_trace.record_enterprise_operation(event)
    create.reset_mock()
    for field in ("tenant_id", "app_id"):
        event.payload[field] = str(uuid4())
        with pytest.raises(ValueError, match="owner mismatch"):
            operation_trace.record_enterprise_operation(event)
        event.payload[field] = tenant_id if field == "tenant_id" else app_id
    operation_trace.record_enterprise_operation(AppCreatedEvent(context=event.context, payload={"app_id": app_id}))
    operation_trace.record_enterprise_operation(AppCreatedEvent(context=TelemetryContext(), payload={"app_id": app_id}))
    create.assert_not_called()
