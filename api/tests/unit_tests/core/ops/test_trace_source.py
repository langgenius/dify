import json
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.ops import trace_source
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import TraceProviderSettings
from core.ops.trace_queue import TraceQueue
from core.telemetry.events import (
    AppCreatedEvent,
    DraftNodeExecutionTraceEvent,
    PromptGenerationEvent,
    TelemetryContext,
)
from enums import DeploymentEdition
from models.account import Tenant
from models.dataset import Pipeline
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message, TraceAppConfig
from models.workflow import Workflow, WorkflowType
from services.ops_trace_service import update_app_trace_settings


def seed_trace_owner(session: Session) -> tuple[Tenant, App, TraceAppConfig]:
    tenant = Tenant(name="trace tenant")
    session.add(tenant)
    session.flush()
    app = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Tracing app",
        enable_site=True,
        enable_api=True,
        mode=AppMode.CHAT,
        tracing=json.dumps({"enabled": True, "tracing_provider": "langfuse"}),
    )
    session.add(app)
    session.flush()
    config = TraceAppConfig(
        app_id=app.id, tracing_provider="langfuse", tracing_config={"public_key": "cipher-a", "secret_key": "cipher-b"}
    )
    session.add(config)
    session.commit()
    return tenant, app, config


def test_config_snapshot_cannot_switch_tenant_provider_or_revision(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(SECRET_KEY="ops-test-key")
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(trace_source, "_enterprise_config", lambda: None)
    tenant, app, config = seed_trace_owner(sqlite_session)
    settings = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    decrypt = Mock(return_value={"secret_key": "decrypted"})
    monkeypatch.setattr(trace_source, "decrypt_provider_config", decrypt)
    assert trace_source.load_trace_provider_config(settings) == {"secret_key": "decrypted"}
    decrypt.assert_called_once_with(tenant.id, "langfuse", config.tracing_config)
    decrypt.reset_mock()
    with pytest.raises(ValueError):
        trace_source.load_trace_provider_config(settings.model_copy(update={"tenant_id": str(uuid4())}))
    with pytest.raises(ValueError):
        trace_source.load_trace_provider_config(settings.model_copy(update={"app_id": str(uuid4())}))
    decrypt.assert_not_called()
    update_app_trace_settings(tenant_id=tenant.id, app_id=app.id, enabled=False, tracing_provider="langfuse")
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(settings)
    decrypt.assert_not_called()


def test_settings_hash_is_keyed_tenant_scoped_and_detects_credential_changes(
    config_overrides: Callable[..., None],
) -> None:
    tenant_id = str(uuid4())
    settings = {"endpoint": "https://collector.example", "api_key": "private-token"}
    config_overrides(SECRET_KEY="ops-test-key")
    fingerprint = trace_source._settings_hash(tenant_id, settings)
    assert fingerprint == trace_source._settings_hash(tenant_id, dict(reversed(settings.items())))
    assert fingerprint != trace_source._settings_hash(str(uuid4()), settings)
    assert fingerprint != trace_source._settings_hash(tenant_id, {**settings, "api_key": "rotated-token"})
    config_overrides(SECRET_KEY="rotated-ops-test-key")
    assert fingerprint != trace_source._settings_hash(tenant_id, settings)
    config_overrides(SECRET_KEY="")
    with pytest.raises(ValueError, match="require SECRET_KEY"):
        trace_source._settings_hash(tenant_id, settings)


def test_message_lookup_checks_tenant_app_and_conversation(
    sqlite_session: Session, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=sqlite_engine))
    tenant, app, _ = seed_trace_owner(sqlite_session)
    conversation = Conversation(
        app_id=app.id,
        mode=AppMode.CHAT,
        name="Chat",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from="web-app",
        from_source=ConversationFromSource.API,
        from_end_user_id=str(uuid4()),
    )
    sqlite_session.add(conversation)
    sqlite_session.flush()
    message = Message(
        app_id=app.id,
        conversation_id=conversation.id,
        inputs={},
        total_price=0,
        query="question",
        message="prompt",
        answer="private answer",
        message_unit_price=0,
        answer_unit_price=0,
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    sqlite_session.add(message)
    sqlite_session.commit()
    fields = trace_source.read_message_trace_fields(tenant.id, app.id, message.id)
    assert fields["outputs"] == "private answer"
    for tenant_id, app_id in ((str(uuid4()), app.id), (tenant.id, str(uuid4()))):
        with pytest.raises(ValueError, match="not found"):
            trace_source.read_message_trace_fields(tenant_id, app_id, message.id)
    conversation.app_id = str(uuid4())
    sqlite_session.commit()
    with pytest.raises(ValueError, match="not found"):
        trace_source.read_message_trace_fields(tenant.id, app.id, message.id)


def test_enterprise_source_rejects_payload_owner_mismatch_before_recording(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.telemetry.events import DraftNodeExecutionTraceEvent, TelemetryContext

    event = DraftNodeExecutionTraceEvent(
        context=TelemetryContext(tenant_id=str(uuid4()), app_id=str(uuid4())),
        payload={"node_execution_data": {"tenant_id": str(uuid4()), "app_id": str(uuid4())}},
    )
    create = Mock()
    monkeypatch.setattr(trace_source, "create_message_trace", create)
    with pytest.raises(ValueError, match="owner mismatch"):
        trace_source.record_enterprise_operation(event)
    create.assert_not_called()


@pytest.fixture
def trace_owner(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> tuple[Tenant, App, TraceAppConfig]:
    config_overrides(SECRET_KEY="ops-test-key")
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(trace_source, "_enterprise_config", lambda: None)
    return seed_trace_owner(sqlite_session)


def test_enterprise_config_respects_enablement_and_parses_headers(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE, ENTERPRISE_TELEMETRY_ENABLED=False)
    assert trace_source._enterprise_config() is None
    config_overrides(
        ENTERPRISE_TELEMETRY_ENABLED=True,
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example",
        ENTERPRISE_OTLP_HEADERS="authorization=Bearer%20token",
        ENTERPRISE_OTLP_API_KEY="private-key",
        ENTERPRISE_INCLUDE_CONTENT=False,
        ENTERPRISE_OTEL_SAMPLING_RATE=0.25,
    )
    settings = trace_source._enterprise_config()
    assert settings is not None
    assert settings["endpoint"] == "https://collector.example"
    assert settings["headers"] == {"authorization": "Bearer token"}
    assert settings["api_key"] == "private-key"
    assert settings["include_content"] is False
    assert settings["sampling_rate"] == 0.25


@pytest.mark.parametrize("with_app", [False, True])
def test_enterprise_delivery_rechecks_owner_and_settings(
    trace_owner: tuple[Tenant, App, TraceAppConfig], monkeypatch: pytest.MonkeyPatch, with_app: bool
) -> None:
    tenant, app, _ = trace_owner
    enterprise = {"endpoint": "https://collector.example", "api_key": "first-key"}
    monkeypatch.setattr(trace_source, "_enterprise_config", lambda: enterprise)
    destinations = trace_source.get_trace_provider_settings(tenant.id, app.id if with_app else None)
    settings = next(item for item in destinations if item.destination_type == "enterprise")
    assert trace_source.load_trace_provider_config(settings) == enterprise
    for changes in (
        {"tenant_id": str(uuid4())},
        {"app_id": str(uuid4())},
        {"destination_settings_hash": "é" * 64},
    ):
        with pytest.raises(ValueError, match="configuration_changed"):
            trace_source.load_trace_provider_config(settings.model_copy(update=changes))
    enterprise["api_key"] = "rotated-key"
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(settings)
    monkeypatch.setattr(trace_source, "_enterprise_config", lambda: None)
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(settings)


def test_settings_lookup_rejects_missing_owner_and_skips_unconfigured_destinations(
    trace_owner: tuple[Tenant, App, TraceAppConfig], sqlite_session: Session
) -> None:
    tenant, app, config = trace_owner
    with pytest.raises(ValueError, match="tenant not found"):
        trace_source.get_trace_provider_settings(str(uuid4()), app.id)
    with pytest.raises(ValueError, match="app not found"):
        trace_source.get_trace_provider_settings(tenant.id, str(uuid4()))
    app.tracing = None
    sqlite_session.commit()
    assert trace_source.get_trace_provider_settings(tenant.id, app.id) == ()
    app.tracing = json.dumps({"enabled": True, "tracing_provider": "langsmith"})
    sqlite_session.commit()
    assert trace_source.get_trace_provider_settings(tenant.id, app.id) == ()
    app.tracing = json.dumps({"enabled": True, "tracing_provider": "langfuse"})
    config.tracing_config = None
    sqlite_session.commit()
    assert trace_source.get_trace_provider_settings(tenant.id, app.id) == ()


@pytest.mark.parametrize("change", ["disabled", "provider", "credentials", "digest"])
def test_delivery_rejects_config_changes_even_without_a_revision_increment(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    change: str,
) -> None:
    tenant, app, config = trace_owner
    settings = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    decrypt = Mock()
    monkeypatch.setattr(trace_source, "decrypt_provider_config", decrypt)
    if change == "digest":
        settings = settings.model_copy(update={"destination_settings_hash": "é" * 64})
    elif change == "credentials":
        config.tracing_config = {"secret_key": "rotated"}
    else:
        app.tracing = json.dumps({"enabled": change != "disabled", "tracing_provider": "langsmith"})
    sqlite_session.commit()
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(settings)
    decrypt.assert_not_called()


def test_message_factory_uses_the_app_queue_and_rejects_foreign_pipelines(
    trace_owner: tuple[Tenant, App, TraceAppConfig], sqlite_session: Session
) -> None:
    tenant, app, _ = trace_owner
    pipeline = Pipeline(tenant_id=tenant.id, name="Pipeline", description="")
    sqlite_session.add(pipeline)
    sqlite_session.commit()
    flask_app = Flask(__name__)
    queue = Mock(spec=TraceQueue)
    message_id, conversation_id = str(uuid4()), str(uuid4())
    with flask_app.app_context():
        assert trace_source.create_message_trace(tenant_id=tenant.id, app_id=app.id) is None
        flask_app.extensions["ops_trace_queue"] = queue
        recorder = trace_source.create_message_trace(
            tenant_id=tenant.id, app_id=app.id, message_id=message_id, conversation_id=conversation_id
        )
        assert recorder is not None
        assert recorder.trace_queue is queue
        assert recorder.source.operation_id == message_id
        assert recorder.source.conversation_id == conversation_id
        assert recorder.provider_settings[0].app_id == app.id
        pipeline_recorder = trace_source.create_message_trace(tenant_id=tenant.id, pipeline_id=pipeline.id)
        assert pipeline_recorder is not None
        assert pipeline_recorder.source.pipeline_id == pipeline.id
        assert pipeline_recorder.source.app_id is None
        pipeline.tenant_id = str(uuid4())
        sqlite_session.commit()
        assert trace_source.create_message_trace(tenant_id=tenant.id, pipeline_id=pipeline.id) is None
    assert trace_source.create_message_trace(tenant_id=tenant.id, app_id=app.id) is None
    queue.submit_trace.assert_not_called()


@pytest.mark.parametrize("pipeline_run", [False, True])
def test_draft_operation_authorizes_its_owner_and_only_uses_enterprise_destinations(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    pipeline_run: bool,
) -> None:
    tenant, app, _ = trace_owner
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
    recorder.provider_settings = (trace_source.get_trace_provider_settings(tenant.id, app.id)[0], enterprise)
    create = Mock(return_value=recorder)
    monkeypatch.setattr(trace_source, "create_message_trace", create)
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
    trace_source.record_enterprise_operation(event)
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
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    missing: str,
) -> None:
    tenant, _, _ = trace_owner
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
    monkeypatch.setattr(trace_source, "create_message_trace", create)
    event = DraftNodeExecutionTraceEvent(
        context=TelemetryContext(tenant_id=tenant.id, app_id=owner_id),
        payload={"node_execution_data": {"tenant_id": tenant.id, "app_id": owner_id, "workflow_id": workflow_id}},
    )
    with pytest.raises(ValueError, match=f"Trace {missing} not found"):
        trace_source.record_enterprise_operation(event)
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
    monkeypatch.setattr(trace_source, "create_message_trace", create)
    trace_source.record_enterprise_operation(event)
    assert recorder.record_operation.call_args.kwargs["outputs"] == "Generated prompt"
    assert recorder.record_operation.call_args.kwargs["usage"]["total_tokens"] == 5
    create.return_value = None
    trace_source.record_enterprise_operation(event)
    create.reset_mock()
    for field in ("tenant_id", "app_id"):
        event.payload[field] = str(uuid4())
        with pytest.raises(ValueError, match="owner mismatch"):
            trace_source.record_enterprise_operation(event)
        event.payload[field] = tenant_id if field == "tenant_id" else app_id
    trace_source.record_enterprise_operation(AppCreatedEvent(context=event.context, payload={"app_id": app_id}))
    trace_source.record_enterprise_operation(AppCreatedEvent(context=TelemetryContext(), payload={"app_id": app_id}))
    create.assert_not_called()
