from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.trigger.constants import TRIGGER_WEBHOOK_NODE_TYPE
from enums.quota_type import QuotaType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow
from services.errors.app import QuotaExceededError
from services.trigger.webhook_service import WebhookService


class WebhookServiceRelationshipFactory:
    @staticmethod
    def create_account_and_tenant(db_session_with_containers: Session) -> tuple[Account, Tenant]:
        account = Account(
            name=f"Account {uuid4()}",
            email=f"webhook-{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(name=f"Tenant {uuid4()}", plan="basic", status="normal")
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_app(db_session_with_containers: Session, tenant: Tenant, account: Account) -> App:
        app = App(
            tenant_id=tenant.id,
            name=f"Webhook App {uuid4()}",
            description="",
            mode="workflow",
            icon_type="emoji",
            icon="bot",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=True,
            api_rpm=100,
            api_rph=100,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=account.id,
            updated_by=account.id,
        )
        db_session_with_containers.add(app)
        db_session_with_containers.commit()
        return app

    @staticmethod
    def create_workflow(
        db_session_with_containers: Session,
        *,
        app: App,
        account: Account,
        node_ids: list[str],
        version: str,
    ) -> Workflow:
        graph = {
            "nodes": [
                {
                    "id": node_id,
                    "data": {
                        "type": TRIGGER_WEBHOOK_NODE_TYPE,
                        "title": f"Webhook {node_id}",
                        "method": "post",
                        "content_type": "application/json",
                        "headers": [],
                        "params": [],
                        "body": [],
                        "status_code": 200,
                        "response_body": '{"status": "ok"}',
                        "timeout": 30,
                    },
                }
                for node_id in node_ids
            ],
            "edges": [],
        }

        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            graph=json.dumps(graph),
            features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            version=version,
        )
        db_session_with_containers.add(workflow)
        db_session_with_containers.commit()
        return workflow

    @staticmethod
    def create_webhook_trigger(
        db_session_with_containers: Session,
        *,
        app: App,
        account: Account,
        node_id: str,
        webhook_id: str | None = None,
    ) -> WorkflowWebhookTrigger:
        webhook_trigger = WorkflowWebhookTrigger(
            app_id=app.id,
            node_id=node_id,
            tenant_id=app.tenant_id,
            webhook_id=webhook_id or uuid4().hex[:24],
            created_by=account.id,
        )
        db_session_with_containers.add(webhook_trigger)
        db_session_with_containers.commit()
        return webhook_trigger

    @staticmethod
    def create_app_trigger(
        db_session_with_containers: Session,
        *,
        app: App,
        node_id: str,
        status: AppTriggerStatus,
    ) -> AppTrigger:
        app_trigger = AppTrigger(
            tenant_id=app.tenant_id,
            app_id=app.id,
            node_id=node_id,
            trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
            provider_name="webhook",
            title=f"Webhook {node_id}",
            status=status,
        )
        db_session_with_containers.add(app_trigger)
        db_session_with_containers.commit()
        return app_trigger


class TestWebhookServiceLookupWithContainers:
    def test_get_webhook_trigger_and_workflow_raises_when_app_trigger_missing(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=["node-1"], version="2026-04-14.001"
        )
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="node-1"
        )

        with pytest.raises(ValueError, match="App trigger not found"):
            WebhookService.get_webhook_trigger_and_workflow(webhook_trigger.webhook_id)

    def test_get_webhook_trigger_and_workflow_raises_when_app_trigger_rate_limited(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=["node-1"], version="2026-04-14.001"
        )
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="node-1"
        )
        factory.create_app_trigger(
            db_session_with_containers, app=app, node_id="node-1", status=AppTriggerStatus.RATE_LIMITED
        )

        with pytest.raises(ValueError, match="rate limited"):
            WebhookService.get_webhook_trigger_and_workflow(webhook_trigger.webhook_id)

    def test_get_webhook_trigger_and_workflow_raises_when_app_trigger_disabled(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=["node-1"], version="2026-04-14.001"
        )
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="node-1"
        )
        factory.create_app_trigger(
            db_session_with_containers, app=app, node_id="node-1", status=AppTriggerStatus.DISABLED
        )

        with pytest.raises(ValueError, match="disabled"):
            WebhookService.get_webhook_trigger_and_workflow(webhook_trigger.webhook_id)

    def test_get_webhook_trigger_and_workflow_raises_when_workflow_missing(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="node-1"
        )
        factory.create_app_trigger(
            db_session_with_containers, app=app, node_id="node-1", status=AppTriggerStatus.ENABLED
        )

        with pytest.raises(ValueError, match="Workflow not found"):
            WebhookService.get_webhook_trigger_and_workflow(webhook_trigger.webhook_id)

    def test_get_webhook_trigger_and_workflow_returns_debug_draft_workflow(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        factory.create_workflow(
            db_session_with_containers,
            app=app,
            account=account,
            node_ids=["published-node"],
            version="2026-04-14.001",
        )
        draft_workflow = factory.create_workflow(
            db_session_with_containers,
            app=app,
            account=account,
            node_ids=["debug-node"],
            version=Workflow.VERSION_DRAFT,
        )
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="debug-node"
        )

        got_trigger, got_workflow, got_node_config = WebhookService.get_webhook_trigger_and_workflow(
            webhook_trigger.webhook_id,
            is_debug=True,
        )

        assert got_trigger.id == webhook_trigger.id
        assert got_workflow.id == draft_workflow.id
        assert got_node_config["id"] == "debug-node"


class TestWebhookServiceTriggerExecutionWithContainers:
    def test_trigger_workflow_execution_triggers_async_workflow_successfully(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        workflow = factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=["node-1"], version="2026-04-14.001"
        )
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="node-1"
        )

        end_user = SimpleNamespace(id=str(uuid4()))
        webhook_data = {"body": {"value": 1}, "headers": {}, "query_params": {}, "files": {}, "method": "POST"}

        quota_charge = MagicMock()

        with (
            patch(
                "services.trigger.webhook_service.EndUserService.get_or_create_end_user_by_type",
                return_value=end_user,
            ),
            patch(
                "services.trigger.webhook_service.QuotaService.reserve",
                return_value=quota_charge,
            ) as mock_reserve,
            patch("services.trigger.webhook_service.AsyncWorkflowService.trigger_workflow_async") as mock_trigger,
        ):
            WebhookService.trigger_workflow_execution(webhook_trigger, webhook_data, workflow)

        mock_reserve.assert_called_once()
        reserve_args = mock_reserve.call_args.args
        assert reserve_args[0] == QuotaType.TRIGGER
        assert reserve_args[1] == webhook_trigger.tenant_id
        quota_charge.commit.assert_called_once()
        mock_trigger.assert_called_once()
        trigger_args = mock_trigger.call_args.args
        assert trigger_args[1] is end_user
        assert trigger_args[2].workflow_id == workflow.id
        assert trigger_args[2].root_node_id == webhook_trigger.node_id

    def test_trigger_workflow_execution_marks_tenant_rate_limited_when_quota_exceeded(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        workflow = factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=["node-1"], version="2026-04-14.001"
        )
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="node-1"
        )

        with (
            patch(
                "services.trigger.webhook_service.EndUserService.get_or_create_end_user_by_type",
                return_value=SimpleNamespace(id=str(uuid4())),
            ),
            patch(
                "services.trigger.webhook_service.QuotaService.reserve",
                side_effect=QuotaExceededError(feature="trigger", tenant_id=tenant.id, required=1),
            ),
            patch(
                "services.trigger.webhook_service.AppTriggerService.mark_tenant_triggers_rate_limited"
            ) as mock_mark_rate_limited,
        ):
            with pytest.raises(QuotaExceededError):
                WebhookService.trigger_workflow_execution(
                    webhook_trigger,
                    {"body": {}, "headers": {}, "query_params": {}, "files": {}, "method": "POST"},
                    workflow,
                )

        mock_mark_rate_limited.assert_called_once_with(tenant.id)

    def test_trigger_workflow_execution_logs_and_reraises_unexpected_errors(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        workflow = factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=["node-1"], version="2026-04-14.001"
        )
        webhook_trigger = factory.create_webhook_trigger(
            db_session_with_containers, app=app, account=account, node_id="node-1"
        )

        with (
            patch(
                "services.trigger.webhook_service.EndUserService.get_or_create_end_user_by_type",
                side_effect=RuntimeError("boom"),
            ),
            patch("services.trigger.webhook_service.logger.exception") as mock_logger_exception,
        ):
            with pytest.raises(RuntimeError, match="boom"):
                WebhookService.trigger_workflow_execution(
                    webhook_trigger,
                    {"body": {}, "headers": {}, "query_params": {}, "files": {}, "method": "POST"},
                    workflow,
                )

        mock_logger_exception.assert_called_once()


class TestWebhookServiceRelationshipSyncWithContainers:
    def test_sync_webhook_relationships_raises_when_workflow_exceeds_node_limit(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        node_ids = [f"node-{index}" for index in range(WebhookService.MAX_WEBHOOK_NODES_PER_WORKFLOW + 1)]
        workflow = factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=node_ids, version=Workflow.VERSION_DRAFT
        )

        with pytest.raises(ValueError, match="maximum webhook node limit"):
            WebhookService.sync_webhook_relationships(app, workflow)

    def test_sync_webhook_relationships_raises_when_lock_not_acquired(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        workflow = factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=["node-1"], version=Workflow.VERSION_DRAFT
        )
        lock = MagicMock()
        lock.acquire.return_value = False

        with patch("services.trigger.webhook_service.redis_client.lock", return_value=lock):
            with pytest.raises(RuntimeError, match="Failed to acquire lock"):
                WebhookService.sync_webhook_relationships(app, workflow)

    def test_sync_webhook_relationships_creates_missing_records_and_deletes_stale_records(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        stale_trigger = factory.create_webhook_trigger(
            db_session_with_containers,
            app=app,
            account=account,
            node_id="node-stale",
            webhook_id="stale-webhook-id-000001",
        )
        stale_trigger_id = stale_trigger.id
        workflow = factory.create_workflow(
            db_session_with_containers,
            app=app,
            account=account,
            node_ids=["node-new"],
            version=Workflow.VERSION_DRAFT,
        )

        with patch(
            "services.trigger.webhook_service.WebhookService.generate_webhook_id", return_value="new-webhook-id-000001"
        ):
            WebhookService.sync_webhook_relationships(app, workflow)

        db_session_with_containers.expire_all()
        records = db_session_with_containers.scalars(
            select(WorkflowWebhookTrigger).where(WorkflowWebhookTrigger.app_id == app.id)
        ).all()

        assert [record.node_id for record in records] == ["node-new"]
        assert records[0].webhook_id == "new-webhook-id-000001"
        assert db_session_with_containers.get(WorkflowWebhookTrigger, stale_trigger_id) is None

    def test_sync_webhook_relationships_sets_redis_cache_for_new_record(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        workflow = factory.create_workflow(
            db_session_with_containers,
            app=app,
            account=account,
            node_ids=["node-cache"],
            version=Workflow.VERSION_DRAFT,
        )
        cache_key = f"{WebhookService.__WEBHOOK_NODE_CACHE_KEY__}:{app.id}:node-cache"

        with patch(
            "services.trigger.webhook_service.WebhookService.generate_webhook_id", return_value="cache-webhook-id-00001"
        ):
            WebhookService.sync_webhook_relationships(app, workflow)

        cached_payload = WebhookServiceRelationshipFactory._read_cache(cache_key)
        assert cached_payload is not None
        assert cached_payload["node_id"] == "node-cache"
        assert cached_payload["webhook_id"] == "cache-webhook-id-00001"

    def test_sync_webhook_relationships_logs_when_lock_release_fails(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ):
        del flask_app_with_containers
        factory = WebhookServiceRelationshipFactory
        account, tenant = factory.create_account_and_tenant(db_session_with_containers)
        app = factory.create_app(db_session_with_containers, tenant, account)
        workflow = factory.create_workflow(
            db_session_with_containers, app=app, account=account, node_ids=[], version=Workflow.VERSION_DRAFT
        )
        lock = MagicMock()
        lock.acquire.return_value = True
        lock.release.side_effect = RuntimeError("release failed")

        with (
            patch("services.trigger.webhook_service.redis_client.lock", return_value=lock),
            patch("services.trigger.webhook_service.logger.exception") as mock_logger_exception,
        ):
            WebhookService.sync_webhook_relationships(app, workflow)

        mock_logger_exception.assert_called_once()


def _read_cache(cache_key: str) -> dict[str, str] | None:
    from extensions.ext_redis import redis_client

    cached = redis_client.get(cache_key)
    if not cached:
        return None
    if isinstance(cached, bytes):
        cached = cached.decode("utf-8")
    return json.loads(cached)


WebhookServiceRelationshipFactory._read_cache = staticmethod(_read_cache)
