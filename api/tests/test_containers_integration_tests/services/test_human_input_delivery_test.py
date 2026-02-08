import json
import uuid
from unittest.mock import MagicMock

import pytest

from core.workflow.enums import NodeType
from core.workflow.nodes.human_input.entities import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    HumanInputNodeData,
)
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.workflow_service import WorkflowService


def _create_app_with_draft_workflow(session, *, delivery_method_id: uuid.UUID) -> tuple[App, Account]:
    tenant = Tenant(name="Test Tenant")
    account = Account(name="Tester", email="tester@example.com")
    session.add_all([tenant, account])
    session.flush()

    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=True,
            role=TenantAccountRole.OWNER.value,
        )
    )

    app = App(
        tenant_id=tenant.id,
        name="Test App",
        description="",
        mode=AppMode.WORKFLOW.value,
        icon_type="emoji",
        icon="app",
        icon_background="#ffffff",
        enable_site=True,
        enable_api=True,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add(app)
    session.flush()

    email_method = EmailDeliveryMethod(
        id=delivery_method_id,
        enabled=True,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                whole_workspace=False,
                items=[ExternalRecipient(email="recipient@example.com")],
            ),
            subject="Test {{recipient_email}}",
            body="Body {{#url#}} {{form_content}}",
        ),
    )
    node_data = HumanInputNodeData(
        title="Human Input",
        delivery_methods=[email_method],
        form_content="Hello Human Input",
        inputs=[],
        user_actions=[],
    ).model_dump(mode="json")
    node_data["type"] = NodeType.HUMAN_INPUT.value
    graph = json.dumps({"nodes": [{"id": "human-node", "data": node_data}], "edges": []})

    workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW.value,
        version=Workflow.VERSION_DRAFT,
        graph=graph,
        features=json.dumps({}),
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    session.add(workflow)
    session.commit()

    return app, account


def test_human_input_delivery_test_sends_email(
    db_session_with_containers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delivery_method_id = uuid.uuid4()
    app, account = _create_app_with_draft_workflow(db_session_with_containers, delivery_method_id=delivery_method_id)

    send_mock = MagicMock()
    monkeypatch.setattr("services.human_input_delivery_test_service.mail.is_inited", lambda: True)
    monkeypatch.setattr("services.human_input_delivery_test_service.mail.send", send_mock)

    service = WorkflowService()
    service.test_human_input_delivery(
        app_model=app,
        account=account,
        node_id="human-node",
        delivery_method_id=str(delivery_method_id),
    )

    assert send_mock.call_count == 1
    assert send_mock.call_args.kwargs["to"] == "recipient@example.com"
