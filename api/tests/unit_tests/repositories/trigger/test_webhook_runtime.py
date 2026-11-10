"""Real SQL ownership and publication transactions for native webhooks."""

import json
from dataclasses import dataclass
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App, AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow, WorkflowDataError
from repositories.trigger.app_repository import SQLAlchemyAppTriggerRepository
from services.trigger.webhook_service import WebhookBindingService, WebhookContext, WebhookNotFoundError


@dataclass(frozen=True)
class WebhookSeed:
    tenant_id: str
    app_id: str
    account_id: str
    webhook_id: str
    workflow_id: str
    draft_id: str
    trigger_id: str


@pytest.fixture
def webhook_seed(sqlite_session_factory: sessionmaker[Session]) -> WebhookSeed:
    tenant_id, account_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        app = App(
            tenant_id=tenant_id,
            name="Webhook app",
            mode=AppMode.WORKFLOW,
            created_by=account_id,
            enable_site=True,
            enable_api=True,
            max_active_requests=0,
        )
        session.add(app)
        session.flush()
        graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "hook",
                        "data": {
                            "type": "trigger-webhook",
                            "title": "Webhook",
                            "method": "post",
                            "content_type": "application/json",
                            "headers": [],
                            "params": [],
                            "body": [],
                        },
                    }
                ],
                "edges": [],
            }
        )
        workflows = [
            Workflow.new(
                tenant_id=tenant_id,
                app_id=app.id,
                type="workflow",
                version=version,
                graph=graph,
                features="{}",
                created_by=account_id,
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )
            for version in ("published", Workflow.VERSION_DRAFT)
        ]
        app.workflow_id = workflows[0].id
        webhook = WorkflowWebhookTrigger(
            tenant_id=tenant_id,
            app_id=app.id,
            node_id="hook",
            created_by=account_id,
            webhook_id="abcdefghijklmnopqrstuvwx",
        )
        trigger = AppTrigger(
            tenant_id=tenant_id,
            app_id=app.id,
            node_id="hook",
            title="Webhook",
            trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
            status=AppTriggerStatus.ENABLED,
        )
        session.add_all([*workflows, webhook, trigger])
        session.flush()
        return WebhookSeed(
            tenant_id, app.id, account_id, webhook.webhook_id, workflows[0].id, workflows[1].id, trigger.id
        )


def test_webhook_context_is_detached_and_uses_the_selected_version(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, webhook_seed: WebhookSeed
) -> None:
    repository = SQLAlchemyAppTriggerRepository(session_factory=sqlite_session_factory)
    live = repository.get_webhook_context(webhook_id=webhook_seed.webhook_id, debug=False)
    draft = repository.get_webhook_context(webhook_id=webhook_seed.webhook_id, debug=True)
    assert isinstance(live, WebhookContext)
    assert isinstance(draft, WebhookContext)
    assert live.workflow_id == webhook_seed.workflow_id
    assert live.status == AppTriggerStatus.ENABLED
    assert draft.workflow_id == webhook_seed.draft_id
    assert draft.status is None
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    assert pool.checkedout() == 0
    assert live.node_config["data"]["type"] == "trigger-webhook"
    live.node_config["id"] = "local mutation"
    refreshed = repository.get_webhook_context(webhook_id=webhook_seed.webhook_id, debug=False)
    assert isinstance(refreshed, WebhookContext)
    assert refreshed.node_config["data"]["title"] == "Webhook"


@pytest.mark.parametrize("mismatch", ["tenant", "app", "node", "type", "missing"])
def test_published_webhook_requires_matching_app_trigger(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        trigger = session.get(AppTrigger, webhook_seed.trigger_id)
        assert trigger is not None
        if mismatch == "tenant":
            trigger.tenant_id = str(uuid4())
        elif mismatch == "app":
            trigger.app_id = str(uuid4())
        elif mismatch == "node":
            trigger.node_id = "decoy"
        elif mismatch == "type":
            trigger.trigger_type = AppTriggerType.TRIGGER_PLUGIN
        else:
            session.delete(trigger)
    repository = SQLAlchemyAppTriggerRepository(session_factory=sqlite_session_factory)
    with pytest.raises(WebhookNotFoundError):
        repository.get_webhook_context(webhook_id=webhook_seed.webhook_id, debug=False)
    draft = repository.get_webhook_context(webhook_id=webhook_seed.webhook_id, debug=True)
    assert isinstance(draft, WebhookContext)
    assert draft.workflow_id == webhook_seed.draft_id


@pytest.mark.parametrize("mismatch", ["tenant", "app", "draft", "missing_node"])
def test_published_webhook_rejects_invalid_workflow_owner_chain(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        workflow = session.get(Workflow, webhook_seed.workflow_id)
        assert workflow is not None
        if mismatch == "tenant":
            workflow.tenant_id = str(uuid4())
        elif mismatch == "app":
            workflow.app_id = str(uuid4())
        elif mismatch == "draft":
            workflow.version = Workflow.VERSION_DRAFT
        else:
            workflow.graph = '{"nodes": [], "edges": []}'
    repository = SQLAlchemyAppTriggerRepository(session_factory=sqlite_session_factory)
    error = WorkflowDataError if mismatch == "missing_node" else WebhookNotFoundError
    with pytest.raises(error):
        repository.get_webhook_context(webhook_id=webhook_seed.webhook_id, debug=False)


def test_draft_undo_keeps_url_and_published_delete_joins_caller_transaction(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed
) -> None:
    repository = SQLAlchemyAppTriggerRepository(session_factory=sqlite_session_factory)
    service = WebhookBindingService(sync_bindings=repository.sync_draft_webhooks)
    service.sync(
        tenant_id=webhook_seed.tenant_id, app_id=webhook_seed.app_id, created_by=webhook_seed.account_id, node_ids=[]
    )
    service.sync(
        tenant_id=webhook_seed.tenant_id,
        app_id=webhook_seed.app_id,
        created_by=webhook_seed.account_id,
        node_ids=["hook", "new"],
    )
    with sqlite_session_factory() as session:
        rows = session.scalars(select(WorkflowWebhookTrigger)).all()
        assert len(rows) == 2
        assert {r.webhook_id for r in rows if r.node_id == "hook"} == {webhook_seed.webhook_id}
        repository.sync_webhooks(
            session=session,
            tenant_id=webhook_seed.tenant_id,
            app_id=webhook_seed.app_id,
            created_by=webhook_seed.account_id,
            node_ids=[],
            remove_stale=True,
        )
        session.flush()
        assert session.scalars(select(WorkflowWebhookTrigger)).all() == []
        session.rollback()
    with sqlite_session_factory.begin() as session:
        assert len(session.scalars(select(WorkflowWebhookTrigger)).all()) == 2
        repository.sync_webhooks(
            session=session,
            tenant_id=webhook_seed.tenant_id,
            app_id=webhook_seed.app_id,
            created_by=webhook_seed.account_id,
            node_ids=["new"],
            remove_stale=True,
        )
    with sqlite_session_factory() as session:
        assert [r.node_id for r in session.scalars(select(WorkflowWebhookTrigger))] == ["new"]


def test_missing_app_creator_is_rejected_only_when_creating_webhooks(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed
) -> None:
    repository = SQLAlchemyAppTriggerRepository(session_factory=sqlite_session_factory)
    repository.sync_draft_webhooks(
        tenant_id=webhook_seed.tenant_id, app_id=webhook_seed.app_id, created_by=None, node_ids=["hook"]
    )
    with pytest.raises(RuntimeError, match="App is missing created_by"):
        repository.sync_draft_webhooks(
            tenant_id=webhook_seed.tenant_id, app_id=webhook_seed.app_id, created_by=None, node_ids=["hook", "new"]
        )


def test_binding_limit_validated_before_writing(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed
) -> None:
    repository = SQLAlchemyAppTriggerRepository(session_factory=sqlite_session_factory)
    service = WebhookBindingService(sync_bindings=repository.sync_draft_webhooks)
    with pytest.raises(ValueError, match="maximum webhook node limit"):
        service.sync(
            tenant_id=webhook_seed.tenant_id,
            app_id=webhook_seed.app_id,
            created_by=webhook_seed.account_id,
            node_ids=[str(i) for i in range(6)],
        )
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(WorkflowWebhookTrigger)).all()) == 1
