from __future__ import annotations

import inspect
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.app import workflow_trigger as workflow_trigger_module
from models.base import TypeBase
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App, AppMode, IconType
from models.trigger import AppTrigger


@pytest.fixture
def database_session(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch):
    models = (App, AppTrigger)
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    monkeypatch.setattr(workflow_trigger_module, "db", SimpleNamespace(engine=sqlite_engine))
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _persist_app_trigger(
    session: Session,
    *,
    tenant_id: str | None = None,
    status: AppTriggerStatus = AppTriggerStatus.ENABLED,
) -> tuple[App, AppTrigger]:
    tenant_id = tenant_id or str(uuid.uuid4())
    app_model = App(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Workflow App",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="workflow",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=True,
    )
    trigger = AppTrigger(
        tenant_id=tenant_id,
        app_id=app_model.id,
        node_id="node-1",
        trigger_type=AppTriggerType.TRIGGER_PLUGIN,
        title="Trigger",
        provider_name="provider",
        status=status,
    )
    session.add_all([app_model, trigger])
    session.commit()
    return app_model, trigger


def test_parser_models_validate():
    parser = workflow_trigger_module.Parser(node_id="node-1")
    enable_parser = workflow_trigger_module.ParserEnable(
        trigger_id="550e8400-e29b-41d4-a716-446655440000", enable_trigger=True
    )

    assert parser.node_id == "node-1"
    assert enable_parser.enable_trigger is True


def test_workflow_trigger_response_serializes_datetime():
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    trigger = AppTrigger(
        tenant_id=str(uuid.uuid4()),
        app_id=str(uuid.uuid4()),
        trigger_type=AppTriggerType.TRIGGER_PLUGIN,
        title="Trigger",
        node_id="node-1",
        provider_name="provider",
        status=AppTriggerStatus.ENABLED,
    )
    trigger.icon = "https://example.com/icon"
    trigger.created_at = created_at
    trigger.updated_at = created_at

    payload = workflow_trigger_module.WorkflowTriggerResponse.model_validate(trigger, from_attributes=True).model_dump(
        mode="json"
    )
    assert payload["id"] == trigger.id
    assert payload["created_at"] == "2026-01-02T03:04:05Z"
    assert payload["updated_at"] == "2026-01-02T03:04:05Z"


def test_webhook_trigger_response_serializes_datetime():
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    webhook = {
        "id": "webhook-1",
        "webhook_id": "whk-1",
        "webhook_url": "https://example.com/hook",
        "webhook_debug_url": "https://example.com/hook/debug",
        "node_id": "node-1",
        "created_at": created_at,
    }

    payload = workflow_trigger_module.WebhookTriggerResponse.model_validate(webhook).model_dump(mode="json")
    assert payload["webhook_id"] == "whk-1"
    assert payload["created_at"] == "2026-01-02T03:04:05Z"


def test_app_triggers_get_uses_injected_tenant_id(app: Flask, database_session: Session) -> None:
    app_model, trigger = _persist_app_trigger(database_session)
    other_tenant_trigger = AppTrigger(
        tenant_id=str(uuid.uuid4()),
        app_id=app_model.id,
        node_id="node-1",
        trigger_type=AppTriggerType.TRIGGER_PLUGIN,
        title="Other Tenant Trigger",
        provider_name="provider",
        status=AppTriggerStatus.ENABLED,
    )
    database_session.add(other_tenant_trigger)
    database_session.commit()

    api = workflow_trigger_module.AppTriggersApi()
    method = inspect.unwrap(api.get)

    with app.test_request_context("/"):
        response = method(api, app_model.tenant_id, app_model)

    assert [item["id"] for item in response["data"]] == [trigger.id]
    assert response["data"][0]["icon"].endswith("/provider/icon")


def test_app_trigger_enable_uses_injected_tenant_id(app: Flask, database_session: Session) -> None:
    app_model, trigger = _persist_app_trigger(database_session, status=AppTriggerStatus.DISABLED)
    payload = {"trigger_id": trigger.id, "enable_trigger": True}

    api = workflow_trigger_module.AppTriggerEnableApi()
    method = inspect.unwrap(api.post)

    with (
        app.test_request_context("/", json=payload),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
    ):
        response = method(api, app_model.tenant_id, app_model)

    assert response["id"] == trigger.id
    assert response["status"] == "enabled"
    database_session.expire_all()
    persisted_trigger = database_session.get(AppTrigger, trigger.id)
    assert persisted_trigger is not None
    assert persisted_trigger.status == AppTriggerStatus.ENABLED
