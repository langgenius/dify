import json
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.ops import trace_source
from models.account import Tenant
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
