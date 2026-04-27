import uuid
from unittest.mock import MagicMock, Mock

import pytest
from sqlalchemy.orm import sessionmaker

from core.workflow.human_input_adapter import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    MemberRecipient,
)
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.human_input.entities import HumanInputNodeData
from models import Account
from models.model import App
from services import workflow_service as workflow_service_module
from services.workflow_service import WorkflowService


def _make_service() -> WorkflowService:
    return WorkflowService(session_maker=sessionmaker())


def _build_node_config(delivery_methods: list[EmailDeliveryMethod]) -> dict[str, object]:
    return {
        "id": "node-1",
        "data": HumanInputNodeData(
            title="Human Input",
            type=BuiltinNodeTypes.HUMAN_INPUT,
            delivery_methods=delivery_methods,
            form_content="Test content",
            inputs=[],
            user_actions=[],
        ),
    }


def _make_email_method(enabled: bool = True, debug_mode: bool = False) -> EmailDeliveryMethod:
    return EmailDeliveryMethod(
        id=uuid.uuid4(),
        enabled=enabled,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                include_bound_group=False,
                items=[ExternalRecipient(email="tester@example.com")],
            ),
            subject="Test subject",
            body="Test body",
            debug_mode=debug_mode,
        ),
    )


def _make_app() -> Mock:
    return Mock(spec=App, tenant_id="tenant-1", id="app-1")


def _make_account() -> Mock:
    return Mock(spec=Account, id="account-1")


def test_human_input_delivery_requires_draft_workflow():
    service = _make_service()
    service.get_draft_workflow = MagicMock(return_value=None)  # type: ignore[method-assign]

    with pytest.raises(ValueError, match="Workflow not initialized"):
        service.test_human_input_delivery(
            app_model=_make_app(),
            account=_make_account(),
            node_id="node-1",
            delivery_method_id="delivery-1",
        )


def test_human_input_delivery_allows_disabled_method(monkeypatch: pytest.MonkeyPatch):
    service = _make_service()
    delivery_method = _make_email_method(enabled=False)
    node_config = _build_node_config([delivery_method])
    workflow = MagicMock()
    workflow.get_node_config_by_id.return_value = node_config
    service.get_draft_workflow = MagicMock(return_value=workflow)  # type: ignore[method-assign]
    service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[attr-defined]
    node_stub = MagicMock()
    node_stub._render_form_content_before_submission.return_value = "rendered"
    node_stub._resolve_default_values.return_value = {}
    service._build_human_input_node = MagicMock(return_value=node_stub)  # type: ignore[attr-defined]
    service._create_human_input_delivery_test_form = MagicMock(  # type: ignore[attr-defined]
        return_value=("form-1", {})
    )

    test_service_instance = MagicMock()
    monkeypatch.setattr(
        workflow_service_module,
        "HumanInputDeliveryTestService",
        MagicMock(return_value=test_service_instance),
    )

    service.test_human_input_delivery(
        app_model=_make_app(),
        account=_make_account(),
        node_id="node-1",
        delivery_method_id=str(delivery_method.id),
    )

    test_service_instance.send_test.assert_called_once()


def test_human_input_delivery_dispatches_to_test_service(monkeypatch: pytest.MonkeyPatch):
    service = _make_service()
    delivery_method = _make_email_method(enabled=True)
    node_config = _build_node_config([delivery_method])
    workflow = MagicMock()
    workflow.get_node_config_by_id.return_value = node_config
    service.get_draft_workflow = MagicMock(return_value=workflow)  # type: ignore[method-assign]
    service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[attr-defined]
    node_stub = MagicMock()
    node_stub._render_form_content_before_submission.return_value = "rendered"
    node_stub._resolve_default_values.return_value = {}
    service._build_human_input_node = MagicMock(return_value=node_stub)  # type: ignore[attr-defined]
    service._create_human_input_delivery_test_form = MagicMock(  # type: ignore[attr-defined]
        return_value=("form-1", {})
    )

    test_service_instance = MagicMock()
    monkeypatch.setattr(
        workflow_service_module,
        "HumanInputDeliveryTestService",
        MagicMock(return_value=test_service_instance),
    )

    service.test_human_input_delivery(
        app_model=_make_app(),
        account=_make_account(),
        node_id="node-1",
        delivery_method_id=str(delivery_method.id),
        inputs={"#node-1.output#": "value"},
    )

    pool_args = service._build_human_input_variable_pool.call_args.kwargs
    assert pool_args["manual_inputs"] == {"#node-1.output#": "value"}
    test_service_instance.send_test.assert_called_once()


def test_human_input_delivery_debug_mode_overrides_recipients(monkeypatch: pytest.MonkeyPatch):
    service = _make_service()
    delivery_method = _make_email_method(enabled=True, debug_mode=True)
    node_config = _build_node_config([delivery_method])
    workflow = MagicMock()
    workflow.get_node_config_by_id.return_value = node_config
    service.get_draft_workflow = MagicMock(return_value=workflow)  # type: ignore[method-assign]
    service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[attr-defined]
    node_stub = MagicMock()
    node_stub._render_form_content_before_submission.return_value = "rendered"
    node_stub._resolve_default_values.return_value = {}
    service._build_human_input_node = MagicMock(return_value=node_stub)  # type: ignore[attr-defined]
    service._create_human_input_delivery_test_form = MagicMock(  # type: ignore[attr-defined]
        return_value=("form-1", {})
    )

    test_service_instance = MagicMock()
    monkeypatch.setattr(
        workflow_service_module,
        "HumanInputDeliveryTestService",
        MagicMock(return_value=test_service_instance),
    )

    account = _make_account()
    service.test_human_input_delivery(
        app_model=_make_app(),
        account=account,
        node_id="node-1",
        delivery_method_id=str(delivery_method.id),
    )

    test_service_instance.send_test.assert_called_once()
    sent_method = test_service_instance.send_test.call_args.kwargs["method"]
    assert isinstance(sent_method, EmailDeliveryMethod)
    assert sent_method.config.debug_mode is True
    assert sent_method.config.recipients.include_bound_group is False
    assert len(sent_method.config.recipients.items) == 1
    recipient = sent_method.config.recipients.items[0]
    assert isinstance(recipient, MemberRecipient)
    assert recipient.reference_id == account.id
