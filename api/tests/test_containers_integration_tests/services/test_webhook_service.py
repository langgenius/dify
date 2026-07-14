"""Database integration tests for webhook trigger and workflow lookup."""

import json
from typing import TypedDict

import pytest
from faker import Faker
from flask import Flask
from sqlalchemy.orm import Session

from models.account import Account, Tenant
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow
from services.account_service import AccountService, TenantService
from services.trigger.webhook_service import WebhookService
from tests.test_containers_integration_tests.helpers import generate_valid_password


class WebhookIntegrationData(TypedDict):
    tenant: Tenant
    account: Account
    app: App
    workflow: Workflow
    webhook_trigger: WorkflowWebhookTrigger
    webhook_id: str
    app_trigger: AppTrigger


@pytest.fixture
def test_data(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> WebhookIntegrationData:
    """Persist the complete relationship graph used by webhook lookup."""

    fake = Faker()
    monkeypatch.setattr(
        "services.account_service.FeatureService.get_system_features",
        lambda: type("Features", (), {"is_allow_register": True, "is_allow_create_workspace": True})(),
    )
    account = AccountService.create_account(
        email=fake.email(),
        name=fake.name(),
        interface_language="en-US",
        password=generate_valid_password(fake),
        session=db_session_with_containers,
    )
    TenantService.create_owner_tenant_if_not_exist(account, name=fake.company(), session=db_session_with_containers)
    tenant = account.current_tenant
    assert tenant is not None
    app = App(
        tenant_id=tenant.id,
        name=fake.company(),
        description=fake.text(),
        mode="workflow",
        icon="",
        icon_background="",
        enable_site=True,
        enable_api=True,
    )
    db_session_with_containers.add(app)
    db_session_with_containers.flush()
    workflow_data = {
        "nodes": [
            {
                "id": "webhook_node",
                "type": "webhook",
                "data": {
                    "type": "trigger-webhook",
                    "title": "Test Webhook",
                    "method": "post",
                    "content_type": "application/json",
                    "headers": [
                        {"name": "Authorization", "required": True},
                        {"name": "Content-Type", "required": False},
                    ],
                    "params": [
                        {"name": "version", "required": True},
                        {"name": "format", "required": False},
                    ],
                    "body": [
                        {"name": "message", "type": "string", "required": True},
                        {"name": "count", "type": "number", "required": False},
                        {"name": "upload", "type": "file", "required": False},
                    ],
                    "status_code": 200,
                    "response_body": '{"status": "success"}',
                    "timeout": 30,
                },
            }
        ],
        "edges": [],
    }
    workflow = Workflow(
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        graph=json.dumps(workflow_data),
        features=json.dumps({}),
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        version="1.0",
    )
    db_session_with_containers.add(workflow)
    db_session_with_containers.flush()
    app.workflow_id = workflow.id
    webhook_id = fake.uuid4()[:16]
    webhook_trigger = WorkflowWebhookTrigger(
        app_id=app.id,
        node_id="webhook_node",
        tenant_id=tenant.id,
        webhook_id=webhook_id,
        created_by=account.id,
    )
    db_session_with_containers.add(webhook_trigger)
    db_session_with_containers.flush()
    app_trigger = AppTrigger(
        tenant_id=tenant.id,
        app_id=app.id,
        node_id="webhook_node",
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        provider_name="webhook",
        title="Test Webhook",
        status=AppTriggerStatus.ENABLED,
    )
    db_session_with_containers.add(app_trigger)
    db_session_with_containers.commit()
    return {
        "tenant": tenant,
        "account": account,
        "app": app,
        "workflow": workflow,
        "webhook_trigger": webhook_trigger,
        "webhook_id": webhook_id,
        "app_trigger": app_trigger,
    }


class TestWebhookServiceDatabaseLookup:
    def test_get_webhook_trigger_and_workflow_success(
        self,
        test_data: WebhookIntegrationData,
        flask_app_with_containers: Flask,
    ) -> None:
        with flask_app_with_containers.app_context():
            webhook_trigger, workflow, node_config = WebhookService.get_webhook_trigger_and_workflow(
                test_data["webhook_id"]
            )

        assert webhook_trigger.webhook_id == test_data["webhook_id"]
        assert workflow.app_id == test_data["app"].id
        assert node_config["id"] == "webhook_node"
        assert node_config["data"].title == "Test Webhook"

    def test_get_webhook_trigger_and_workflow_not_found(self, flask_app_with_containers: Flask) -> None:
        with flask_app_with_containers.app_context():
            with pytest.raises(ValueError, match="Webhook not found"):
                WebhookService.get_webhook_trigger_and_workflow("nonexistent_webhook")
