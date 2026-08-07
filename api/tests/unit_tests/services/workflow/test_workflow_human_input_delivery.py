"""Tests for human-input delivery with a persisted draft workflow."""

import json
import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.human_input_adapter import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    MemberRecipient,
)
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from graphon.enums import BuiltinNodeTypes
from models import Account
from models.enums import AppStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services import workflow_service as workflow_service_module
from services.workflow_service import WorkflowService

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


def _make_service(sqlite_session: Session) -> WorkflowService:
    return WorkflowService(
        session_maker=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )


def _app() -> App:
    return App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Test App",
        description="",
        mode=AppMode.WORKFLOW,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        max_active_requests=None,
    )


def _account() -> Account:
    account = Account(name="Test User", email="test@example.com")
    account.id = ACCOUNT_ID
    return account


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


def _persist_workflow(sqlite_session: Session, delivery_methods: list[EmailDeliveryMethod]) -> None:
    node_config = _build_node_config(delivery_methods)
    node_data = node_config["data"]
    assert isinstance(node_data, HumanInputNodeData)
    workflow = Workflow.new(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(
            {
                "nodes": [
                    {
                        "id": node_config["id"],
                        "data": node_data.model_dump(mode="json"),
                    }
                ],
                "edges": [],
            }
        ),
        features="{}",
        created_by=ACCOUNT_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()
    sqlite_session.expunge_all()


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


@pytest.mark.parametrize("sqlite_session", [(Workflow,)], indirect=True)
def test_human_input_delivery_requires_draft_workflow(sqlite_session: Session):
    service = _make_service(sqlite_session)
    app_model = _app()
    account = _account()

    with pytest.raises(ValueError, match="Workflow not initialized"):
        service.test_human_input_delivery(
            app_model=app_model,
            account=account,
            node_id="node-1",
            delivery_method_id="delivery-1",
            session=sqlite_session,
        )
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(Workflow,)], indirect=True)
def test_human_input_delivery_allows_disabled_method(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    service = _make_service(sqlite_session)
    delivery_method = _make_email_method(enabled=False)
    _persist_workflow(sqlite_session, [delivery_method])
    service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[attr-defined]
    node_stub = MagicMock()
    node_stub.render_form_content_before_submission.return_value = "rendered"
    node_stub.resolve_default_values.return_value = {}
    service._build_human_input_node_for_debugging = MagicMock(return_value=node_stub)  # type: ignore[attr-defined]
    service._create_human_input_delivery_test_form = MagicMock(  # type: ignore[attr-defined]
        return_value=("form-1", [])
    )

    test_service_instance = MagicMock()
    monkeypatch.setattr(
        workflow_service_module,
        "HumanInputDeliveryTestService",
        MagicMock(return_value=test_service_instance),
    )

    app_model = _app()
    account = _account()

    service.test_human_input_delivery(
        app_model=app_model,
        account=account,
        node_id="node-1",
        delivery_method_id=str(delivery_method.id),
        session=sqlite_session,
    )

    test_service_instance.send_test.assert_called_once()
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(Workflow,)], indirect=True)
def test_human_input_delivery_dispatches_to_test_service(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    service = _make_service(sqlite_session)
    delivery_method = _make_email_method(enabled=True)
    _persist_workflow(sqlite_session, [delivery_method])
    service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[attr-defined]
    node_stub = MagicMock()
    node_stub.render_form_content_before_submission.return_value = "rendered"
    node_stub.resolve_default_values.return_value = {}
    service._build_human_input_node_for_debugging = MagicMock(return_value=node_stub)  # type: ignore[attr-defined]
    service._create_human_input_delivery_test_form = MagicMock(  # type: ignore[attr-defined]
        return_value=("form-1", [])
    )

    test_service_instance = MagicMock()
    monkeypatch.setattr(
        workflow_service_module,
        "HumanInputDeliveryTestService",
        MagicMock(return_value=test_service_instance),
    )

    app_model = _app()
    account = _account()

    service.test_human_input_delivery(
        app_model=app_model,
        account=account,
        node_id="node-1",
        delivery_method_id=str(delivery_method.id),
        inputs={"#node-1.output#": "value"},
        session=sqlite_session,
    )

    pool_args = service._build_human_input_variable_pool.call_args.kwargs
    assert pool_args["manual_inputs"] == {"#node-1.output#": "value"}
    test_service_instance.send_test.assert_called_once()
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(Workflow,)], indirect=True)
def test_human_input_delivery_debug_mode_overrides_recipients(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    service = _make_service(sqlite_session)
    delivery_method = _make_email_method(enabled=True, debug_mode=True)
    _persist_workflow(sqlite_session, [delivery_method])
    service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[attr-defined]
    node_stub = MagicMock()
    node_stub.render_form_content_before_submission.return_value = "rendered"
    node_stub.resolve_default_values.return_value = {}
    service._build_human_input_node_for_debugging = MagicMock(return_value=node_stub)  # type: ignore[attr-defined]
    service._create_human_input_delivery_test_form = MagicMock(  # type: ignore[attr-defined]
        return_value=("form-1", [])
    )

    test_service_instance = MagicMock()
    monkeypatch.setattr(
        workflow_service_module,
        "HumanInputDeliveryTestService",
        MagicMock(return_value=test_service_instance),
    )

    app_model = _app()
    account = _account()

    service.test_human_input_delivery(
        app_model=app_model,
        account=account,
        node_id="node-1",
        delivery_method_id=str(delivery_method.id),
        session=sqlite_session,
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
    assert sqlite_session.in_transaction()
