import uuid
from types import SimpleNamespace
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
from services import workflow_service as workflow_service_module
from services.workflow_service import WorkflowService


def _build_node_config(delivery_methods):
    node_data = HumanInputNodeData(
        title="Human Input",
        delivery_methods=delivery_methods,
        form_content="Test content",
        inputs=[],
        user_actions=[],
    ).model_dump(mode="json")
    node_data["type"] = NodeType.HUMAN_INPUT.value
    return {"id": "node-1", "data": node_data}


def _make_email_method(enabled: bool = True) -> EmailDeliveryMethod:
    return EmailDeliveryMethod(
        id=uuid.uuid4(),
        enabled=enabled,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                whole_workspace=False,
                items=[ExternalRecipient(email="tester@example.com")],
            ),
            subject="Test subject",
            body="Test body",
        ),
    )


def test_human_input_delivery_requires_draft_workflow():
    service = WorkflowService()
    service.get_draft_workflow = MagicMock(return_value=None)  # type: ignore[method-assign]
    app_model = SimpleNamespace(tenant_id="tenant-1", id="app-1")
    account = SimpleNamespace(id="account-1")

    with pytest.raises(ValueError, match="Workflow not initialized"):
        service.test_human_input_delivery(
            app_model=app_model,
            account=account,
            node_id="node-1",
            delivery_method_id="delivery-1",
        )


def test_human_input_delivery_rejects_disabled_method():
    service = WorkflowService()
    delivery_method = _make_email_method(enabled=False)
    node_config = _build_node_config([delivery_method])
    workflow = MagicMock()
    workflow.get_node_config_by_id.return_value = node_config
    service.get_draft_workflow = MagicMock(return_value=workflow)  # type: ignore[method-assign]

    app_model = SimpleNamespace(tenant_id="tenant-1", id="app-1")
    account = SimpleNamespace(id="account-1")

    with pytest.raises(ValueError, match="Delivery method is disabled"):
        service.test_human_input_delivery(
            app_model=app_model,
            account=account,
            node_id="node-1",
            delivery_method_id=str(delivery_method.id),
        )


def test_human_input_delivery_dispatches_to_test_service(monkeypatch: pytest.MonkeyPatch):
    service = WorkflowService()
    delivery_method = _make_email_method(enabled=True)
    node_config = _build_node_config([delivery_method])
    workflow = MagicMock()
    workflow.get_node_config_by_id.return_value = node_config
    service.get_draft_workflow = MagicMock(return_value=workflow)  # type: ignore[method-assign]
    service._render_human_input_content_for_test = MagicMock(return_value="rendered")  # type: ignore[attr-defined]

    test_service_instance = MagicMock()
    monkeypatch.setattr(
        workflow_service_module,
        "HumanInputDeliveryTestService",
        MagicMock(return_value=test_service_instance),
    )

    app_model = SimpleNamespace(tenant_id="tenant-1", id="app-1")
    account = SimpleNamespace(id="account-1")

    service.test_human_input_delivery(
        app_model=app_model,
        account=account,
        node_id="node-1",
        delivery_method_id=str(delivery_method.id),
    )

    test_service_instance.send_test.assert_called_once()
