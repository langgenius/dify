import json
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.ops import trace_source
from core.ops.provider_config import BaseTracingConfig
from core.ops.trace_queue import TraceQueue
from models.account import Tenant
from models.dataset import Pipeline
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message, TraceAppConfig
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


def test_runtime_credentials_are_bound_to_owner_without_persisting_or_rereading_after_authorization(
    trace_owner: tuple[Tenant, App, TraceAppConfig], monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant, app, config = trace_owner
    runtime_settings = {"authorization": "original-runtime-secret"}
    load_runtime = Mock(side_effect=lambda _config: dict(runtime_settings))
    monkeypatch.setattr(
        BaseTracingConfig, "load_runtime_settings", classmethod(lambda _cls, settings: load_runtime(settings))
    )
    decrypt = Mock(side_effect=lambda _tenant, _provider, settings: dict(settings))
    monkeypatch.setattr(trace_source, "decrypt_provider_config", decrypt)

    settings = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    resolved = trace_source.load_trace_provider_config(settings)

    assert resolved["_runtime_settings"] == runtime_settings
    assert "_runtime_settings" not in (config.tracing_config or {})
    assert runtime_settings["authorization"] not in settings.model_dump_json()
    assert trace_source.get_trace_provider_settings(tenant.id, app.id)[0] == settings
    runtime_settings["authorization"] = "rotated-runtime-secret"
    assert resolved["_runtime_settings"]["authorization"] == "original-runtime-secret"
    decrypt.reset_mock()
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(settings)
    decrypt.assert_not_called()

    load_runtime.reset_mock()
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(settings.model_copy(update={"tenant_id": str(uuid4())}))
    load_runtime.assert_not_called()


def test_noop_and_inactive_config_changes_preserve_pending_destination(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from repositories.app_tracing_config_repository import SQLAlchemyAppTracingConfigRepository

    tenant, app, config = trace_owner
    settings = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    monkeypatch.setattr(trace_source, "decrypt_provider_config", lambda *args: args[-1])
    repository = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    owner = {"workspace_id": tenant.id, "app_id": app.id}
    update_app_trace_settings(tenant_id=tenant.id, app_id=app.id, enabled=True, tracing_provider="langfuse")
    selected = repository.get(**owner, tracing_provider="langfuse")
    assert selected is not None
    assert repository.update(
        **owner,
        tracing_provider="langfuse",
        tracing_config=dict(config.tracing_config or {}),
        expected_revision=selected.revision,
    )
    assert repository.create(**owner, tracing_provider="opik", tracing_config={"project": "inactive"})
    inactive = repository.get(**owner, tracing_provider="opik")
    assert inactive is not None
    assert repository.update(
        **owner,
        tracing_provider="opik",
        tracing_config={"project": "changed"},
        expected_revision=inactive.revision,
    )
    assert repository.delete(**owner, tracing_provider="opik")
    assert trace_source.get_trace_provider_settings(tenant.id, app.id)[0] == settings
    assert trace_source.load_trace_provider_config(settings) == config.tracing_config

    update_app_trace_settings(tenant_id=tenant.id, app_id=app.id, enabled=False, tracing_provider="langfuse")
    update_app_trace_settings(tenant_id=tenant.id, app_id=app.id, enabled=True, tracing_provider="langfuse")
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(settings)


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
        inputs={"topic": "original user variable"},
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
    assert fields["original_inputs"] == {"topic": "original user variable"}
    assert fields["metadata"]["conversation_mode"] == AppMode.CHAT
    assert fields["metadata"]["invoke_from"] == "web-app"
    for tenant_id, app_id in ((str(uuid4()), app.id), (tenant.id, str(uuid4()))):
        with pytest.raises(ValueError, match="not found"):
            trace_source.read_message_trace_fields(tenant_id, app_id, message.id)
    conversation.app_id = str(uuid4())
    sqlite_session.commit()
    with pytest.raises(ValueError, match="not found"):
        trace_source.read_message_trace_fields(tenant.id, app.id, message.id)


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


@pytest.mark.parametrize("unavailable_destination", ["app_provider", "enterprise"])
def test_destination_configuration_failure_preserves_other_destinations(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    unavailable_destination: str,
) -> None:
    tenant, app, _ = trace_owner
    unavailable = Mock(side_effect=ValueError("private configuration contents"))
    monkeypatch.setattr(trace_source, "_enterprise_config", lambda: {"configured": True})
    monkeypatch.setattr(
        trace_source,
        "resolve_provider_config" if unavailable_destination == "app_provider" else "_enterprise_config",
        unavailable,
    )

    settings = trace_source.get_trace_provider_settings(tenant.id, app.id)

    assert len(settings) == 1
    assert settings[0].destination_type != unavailable_destination
    assert settings[0].destination_settings_hash
    assert "Cannot resolve" in caplog.text
    assert "private configuration contents" not in caplog.text


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
    message_id, conversation_id, workflow_run_id = str(uuid4()), str(uuid4()), str(uuid4())
    with flask_app.app_context():
        assert trace_source.create_message_trace(tenant_id=tenant.id, app_id=app.id) is None
        flask_app.extensions["ops_trace_queue"] = queue
        recorder = trace_source.create_message_trace(
            tenant_id=tenant.id,
            app_id=app.id,
            message_id=message_id,
            conversation_id=conversation_id,
            workflow_run_id=workflow_run_id,
        )
        assert recorder is not None
        assert recorder.trace_queue is queue
        assert recorder.source.operation_id == message_id
        assert recorder.source.conversation_id == conversation_id
        assert recorder.source.workflow_run_id == workflow_run_id
        assert recorder.provider_settings[0].app_id == app.id
        assert recorder.attributes["app_name"] == app.name
        assert recorder.attributes["workspace_name"] == tenant.name
        pipeline_recorder = trace_source.create_message_trace(tenant_id=tenant.id, pipeline_id=pipeline.id)
        assert pipeline_recorder is not None
        assert pipeline_recorder.source.pipeline_id == pipeline.id
        assert pipeline_recorder.source.app_id is None
        pipeline.tenant_id = str(uuid4())
        sqlite_session.commit()
        assert trace_source.create_message_trace(tenant_id=tenant.id, pipeline_id=pipeline.id) is None
    assert trace_source.create_message_trace(tenant_id=tenant.id, app_id=app.id) is None
    queue.submit_trace.assert_not_called()
