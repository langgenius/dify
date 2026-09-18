from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, Table, select
from sqlalchemy.orm import Session, sessionmaker

from core.trigger.constants import TRIGGER_WEBHOOK_NODE_TYPE
from models.base import TypeBase
from models.model import App
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from services.trigger import webhook_service
from services.trigger.webhook_service import WebhookService


def test_draft_sync_preserves_webhook_id_when_deleted_node_is_restored(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    webhook_trigger_table = cast(Table, WorkflowWebhookTrigger.__table__)
    TypeBase.metadata.create_all(sqlite_engine, tables=[webhook_trigger_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    app = cast(
        App,
        SimpleNamespace(id="00000000-0000-0000-0000-000000000001", tenant_id="tenant-1", created_by="user-1"),
    )
    webhook_trigger = WorkflowWebhookTrigger(
        app_id=app.id,
        tenant_id=app.tenant_id,
        node_id="webhook-node",
        webhook_id="stable-webhook-id",
        created_by=app.created_by,
    )
    with session_maker.begin() as session:
        session.add(webhook_trigger)
    original_record_id = webhook_trigger.id

    redis = MagicMock()
    redis.get.return_value = None
    redis.lock.return_value.acquire.return_value = True
    monkeypatch.setattr(webhook_service, "db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(webhook_service, "redis_client", redis)

    deleted_draft = cast(Workflow, SimpleNamespace(walk_nodes=lambda _node_type: iter(())))
    WebhookService.sync_webhook_relationships(app, deleted_draft, remove_stale=False)

    restored_draft = cast(
        Workflow,
        SimpleNamespace(walk_nodes=lambda _node_type: iter([("webhook-node", {"type": TRIGGER_WEBHOOK_NODE_TYPE})])),
    )
    WebhookService.sync_webhook_relationships(app, restored_draft, remove_stale=False)

    with Session(sqlite_engine) as session:
        records = session.scalars(select(WorkflowWebhookTrigger)).all()

    assert len(records) == 1
    assert records[0].id == original_record_id
    assert records[0].webhook_id == "stable-webhook-id"


def test_published_sync_removes_stale_webhook_relationships(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    webhook_trigger_table = cast(Table, WorkflowWebhookTrigger.__table__)
    TypeBase.metadata.create_all(sqlite_engine, tables=[webhook_trigger_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    app = cast(
        App,
        SimpleNamespace(id="00000000-0000-0000-0000-000000000001", tenant_id="tenant-1", created_by="user-1"),
    )
    webhook_trigger = WorkflowWebhookTrigger(
        app_id=app.id,
        tenant_id=app.tenant_id,
        node_id="deleted-webhook-node",
        webhook_id="deleted-webhook-id",
        created_by=app.created_by,
    )
    with session_maker.begin() as session:
        session.add(webhook_trigger)

    redis = MagicMock()
    redis.get.return_value = None
    redis.lock.return_value.acquire.return_value = True
    monkeypatch.setattr(webhook_service, "db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(webhook_service, "redis_client", redis)

    published_workflow = cast(Workflow, SimpleNamespace(walk_nodes=lambda _node_type: iter(())))
    WebhookService.sync_webhook_relationships(app, published_workflow, remove_stale=True)

    with session_maker() as session:
        records = session.scalars(select(WorkflowWebhookTrigger)).all()
    assert records == []
    redis.delete.assert_called_once_with(f"{WebhookService.__WEBHOOK_NODE_CACHE_KEY__}:{app.id}:deleted-webhook-node")
