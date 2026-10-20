"""Webhook draft sync preserves stable URLs using the injected database."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.trigger import WorkflowWebhookTrigger
from services.trigger.webhook_service import WebhookService
from tests.unit_tests.model_factories import make_app, make_workflow


def test_draft_sync_preserves_webhook_id_when_deleted_node_is_restored(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app = make_app(created_by="account-1")
    trigger = WorkflowWebhookTrigger(
        app_id=app.id,
        tenant_id=app.tenant_id,
        node_id="webhook-node",
        webhook_id="stable-webhook-id",
        created_by=app.created_by,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([app, trigger])
    original_id = trigger.id
    WebhookService.sync_webhook_relationships(
        app,
        make_workflow(),
        remove_stale=False,
        session_factory=sqlite_session_factory,
    )
    restored = make_workflow(
        graph={"nodes": [{"id": "webhook-node", "data": {"type": "trigger-webhook"}}], "edges": []}
    )
    WebhookService.sync_webhook_relationships(
        app,
        restored,
        remove_stale=False,
        session_factory=sqlite_session_factory,
    )
    with sqlite_session_factory() as session:
        records = session.scalars(select(WorkflowWebhookTrigger)).all()
        assert len(records) == 1
        assert records[0].id == original_id
        assert records[0].webhook_id == "stable-webhook-id"


def test_publication_sync_removes_stale_webhooks(sqlite_session_factory: sessionmaker[Session]) -> None:
    app = make_app(created_by="account-1")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                app,
                WorkflowWebhookTrigger(
                    app_id=app.id,
                    tenant_id=app.tenant_id,
                    node_id="deleted",
                    webhook_id="deleted-webhook",
                    created_by=app.created_by,
                ),
            ]
        )
    WebhookService.sync_webhook_relationships(
        app,
        make_workflow(),
        remove_stale=True,
        session_factory=sqlite_session_factory,
    )
    with sqlite_session_factory() as session:
        assert session.scalars(select(WorkflowWebhookTrigger)).all() == []
