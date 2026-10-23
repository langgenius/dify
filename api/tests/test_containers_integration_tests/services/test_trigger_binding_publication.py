"""Exercise publication signals against real PostgreSQL and Redis in CI."""

import json
from collections.abc import Iterator
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import DeploymentEdition
from models.account import Account, Tenant
from models.model import App, AppMode
from models.trigger import AppTrigger, WorkflowPluginTrigger
from models.workflow import Workflow
from services.workflow_service import WorkflowService


@pytest.fixture
def community_publication(flask_app_with_containers: Flask) -> Iterator[None]:
    assert "application_services" in flask_app_with_containers.extensions
    previous_edition = dify_config.DEPLOYMENT_EDITION
    dify_config.DEPLOYMENT_EDITION = DeploymentEdition.COMMUNITY
    try:
        yield
    finally:
        dify_config.DEPLOYMENT_EDITION = previous_edition


@pytest.mark.usefixtures("community_publication")
@pytest.mark.parametrize("commit", [True, False], ids=["commit", "rollback"])
def test_publish_signal_shares_workflow_and_binding_transaction(
    db_session_with_containers: Session, commit: bool
) -> None:
    tenant = Tenant(name="Binding publication workspace")
    account = Account(name="Publisher", email=f"{uuid4()}@example.com")
    db_session_with_containers.add_all([tenant, account])
    db_session_with_containers.flush()
    app = App(
        tenant_id=tenant.id,
        name="Plugin workflow",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=True,
        created_by=account.id,
    )
    db_session_with_containers.add(app)
    db_session_with_containers.flush()
    previous_subscription_id, next_subscription_id = str(uuid4()), str(uuid4())
    graph: dict[str, object] = {
        "nodes": [
            {
                "id": "plugin-event",
                "data": {
                    "type": "trigger-plugin",
                    "title": "GitHub event",
                    "provider_id": "langgenius/github/github",
                    "provider_name": "github",
                    "event_name": "issues",
                    "subscription_id": next_subscription_id,
                },
            }
        ],
        "edges": [],
    }
    old_workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        version="previous",
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    draft = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(graph),
        features="{}",
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    binding = WorkflowPluginTrigger(
        tenant_id=tenant.id,
        app_id=app.id,
        node_id="plugin-event",
        provider_id="langgenius/github/github",
        event_name="push",
        subscription_id=previous_subscription_id,
    )
    app.workflow_id = old_workflow.id
    db_session_with_containers.add_all([old_workflow, draft, binding])
    db_session_with_containers.commit()
    app_id, account_id, binding_id, old_workflow_id = app.id, account.id, binding.id, old_workflow.id

    # The dataset listener commits db.session; publication must use its own Session,
    # just as the controller does, while the plugin listener borrows that transaction.
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    with sessions() as publisher:
        publisher.execute(text("SET LOCAL statement_timeout = '5s'"))
        published_app = publisher.get(App, app_id)
        publishing_account = publisher.get(Account, account_id)
        assert published_app is not None
        assert publishing_account is not None
        workflow = WorkflowService(sessions).publish_workflow(
            session=publisher, app_model=published_app, account=publishing_account
        )
        new_workflow_id = workflow.id
        published_app.workflow_id = workflow.id
        publisher.flush()
        pending_binding = publisher.get(WorkflowPluginTrigger, binding_id)
        assert pending_binding is not None
        assert pending_binding.subscription_id == next_subscription_id
        assert pending_binding.event_name == "issues"
        assert publisher.scalar(select(AppTrigger.id).where(AppTrigger.app_id == app_id)) is not None
        if commit:
            publisher.commit()
        else:
            publisher.rollback()

    with sessions() as reader:
        saved_app = reader.get(App, app_id)
        saved_binding = reader.get(WorkflowPluginTrigger, binding_id)
        assert saved_app is not None
        assert saved_binding is not None
        assert saved_app.workflow_id == (new_workflow_id if commit else old_workflow_id)
        assert saved_binding.subscription_id == (next_subscription_id if commit else previous_subscription_id)
        assert saved_binding.event_name == ("issues" if commit else "push")
        assert (reader.get(Workflow, new_workflow_id) is not None) == commit
        assert (reader.scalar(select(AppTrigger.id).where(AppTrigger.app_id == app_id)) is not None) == commit
