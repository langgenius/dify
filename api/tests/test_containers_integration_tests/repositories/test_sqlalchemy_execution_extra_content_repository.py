"""Integration tests for SQLAlchemyExecutionExtraContentRepository using Testcontainers.

Part of #32454 — replaces the mock-based unit tests with real database interactions.
"""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from graphon.nodes.human_input.entities import FormDefinition, UserAction
from graphon.nodes.human_input.enums import HumanInputFormStatus
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import ConversationFromSource, InvokeFrom
from models.execution_extra_content import ExecutionExtraContent, HumanInputContent
from models.human_input import (
    ConsoleRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
)
from models.model import App, Conversation, Message
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository


@dataclass
class _TestScope:
    """Per-test data scope used to isolate DB rows.

    IDs are populated after flushing the base entities to the database.
    """

    tenant_id: str = ""
    app_id: str = ""
    user_id: str = ""


def _cleanup_scope_data(session: Session, scope: _TestScope) -> None:
    """Remove test-created DB rows for a test scope."""
    form_ids_subquery = select(HumanInputForm.id).where(
        HumanInputForm.tenant_id == scope.tenant_id,
    )
    session.execute(delete(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids_subquery)))
    session.execute(delete(HumanInputDelivery).where(HumanInputDelivery.form_id.in_(form_ids_subquery)))
    session.execute(
        delete(ExecutionExtraContent).where(
            ExecutionExtraContent.workflow_run_id.in_(
                select(HumanInputForm.workflow_run_id).where(HumanInputForm.tenant_id == scope.tenant_id)
            )
        )
    )
    session.execute(delete(HumanInputForm).where(HumanInputForm.tenant_id == scope.tenant_id))
    session.execute(delete(Message).where(Message.app_id == scope.app_id))
    session.execute(delete(Conversation).where(Conversation.app_id == scope.app_id))
    session.execute(delete(App).where(App.id == scope.app_id))
    session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == scope.tenant_id))
    session.execute(delete(Account).where(Account.id == scope.user_id))
    session.execute(delete(Tenant).where(Tenant.id == scope.tenant_id))
    session.commit()


def _seed_base_entities(session: Session, scope: _TestScope) -> None:
    """Create the base tenant, account, and app needed by tests."""
    tenant = Tenant(name="Test Tenant")
    session.add(tenant)
    session.flush()
    scope.tenant_id = tenant.id

    account = Account(
        name="Test Account",
        email=f"test_{uuid4()}@example.com",
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )
    session.add(account)
    session.flush()
    scope.user_id = account.id

    tenant_join = TenantAccountJoin(
        tenant_id=scope.tenant_id,
        account_id=scope.user_id,
        role=TenantAccountRole.OWNER,
        current=True,
    )
    session.add(tenant_join)

    app = App(
        tenant_id=scope.tenant_id,
        name="Test App",
        description="",
        mode="chat",
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
        created_by=scope.user_id,
        updated_by=scope.user_id,
    )
    session.add(app)
    session.flush()
    scope.app_id = app.id


def _create_conversation(session: Session, scope: _TestScope) -> Conversation:
    conversation = Conversation(
        app_id=scope.app_id,
        mode="chat",
        name="Test Conversation",
        summary="",
        introduction="",
        system_instruction="",
        status="normal",
        invoke_from=InvokeFrom.EXPLORE,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=scope.user_id,
        from_end_user_id=None,
    )
    conversation.inputs = {}
    session.add(conversation)
    session.flush()
    return conversation


def _create_message(
    session: Session,
    scope: _TestScope,
    conversation_id: str,
    workflow_run_id: str,
) -> Message:
    message = Message(
        app_id=scope.app_id,
        conversation_id=conversation_id,
        inputs={},
        query="test query",
        message={"messages": []},
        answer="test answer",
        message_tokens=50,
        message_unit_price=Decimal("0.001"),
        answer_tokens=80,
        answer_unit_price=Decimal("0.001"),
        provider_response_latency=0.5,
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=scope.user_id,
        workflow_run_id=workflow_run_id,
    )
    session.add(message)
    session.flush()
    return message


def _create_submitted_form(
    session: Session,
    scope: _TestScope,
    *,
    workflow_run_id: str,
    action_id: str = "approve",
    action_title: str = "Approve",
    node_title: str = "Approval",
) -> HumanInputForm:
    expiration_time = naive_utc_now() + timedelta(days=1)
    form_definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserAction(id=action_id, title=action_title)],
        rendered_content="rendered",
        expiration_time=expiration_time,
        node_title=node_title,
        display_in_ui=True,
    )
    form = HumanInputForm(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_run_id=workflow_run_id,
        node_id="node-id",
        form_definition=form_definition.model_dump_json(),
        rendered_content=f"Rendered {action_title}",
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=expiration_time,
        selected_action_id=action_id,
    )
    session.add(form)
    session.flush()
    return form


def _create_waiting_form(
    session: Session,
    scope: _TestScope,
    *,
    workflow_run_id: str,
    default_values: dict | None = None,
) -> HumanInputForm:
    expiration_time = naive_utc_now() + timedelta(days=1)
    form_definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserAction(id="approve", title="Approve")],
        rendered_content="rendered",
        expiration_time=expiration_time,
        default_values=default_values or {"name": "John"},
        node_title="Approval",
        display_in_ui=True,
    )
    form = HumanInputForm(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_run_id=workflow_run_id,
        node_id="node-id",
        form_definition=form_definition.model_dump_json(),
        rendered_content="Rendered block",
        status=HumanInputFormStatus.WAITING,
        expiration_time=expiration_time,
    )
    session.add(form)
    session.flush()
    return form


def _create_human_input_content(
    session: Session,
    *,
    workflow_run_id: str,
    message_id: str,
    form_id: str,
) -> HumanInputContent:
    content = HumanInputContent.new(
        workflow_run_id=workflow_run_id,
        message_id=message_id,
        form_id=form_id,
    )
    session.add(content)
    return content


def _create_recipient(
    session: Session,
    *,
    form_id: str,
    delivery_id: str,
    recipient_type: RecipientType = RecipientType.CONSOLE,
    access_token: str = "token-1",
) -> HumanInputFormRecipient:
    payload = ConsoleRecipientPayload(account_id=None)
    recipient = HumanInputFormRecipient(
        form_id=form_id,
        delivery_id=delivery_id,
        recipient_type=recipient_type,
        recipient_payload=payload.model_dump_json(),
        access_token=access_token,
    )
    session.add(recipient)
    return recipient


def _create_delivery(session: Session, *, form_id: str) -> HumanInputDelivery:
    from core.workflow.human_input_compat import DeliveryMethodType
    from models.human_input import ConsoleDeliveryPayload

    delivery = HumanInputDelivery(
        form_id=form_id,
        delivery_method_type=DeliveryMethodType.WEBAPP,
        channel_payload=ConsoleDeliveryPayload().model_dump_json(),
    )
    session.add(delivery)
    session.flush()
    return delivery


@pytest.fixture
def repository(db_session_with_containers: Session) -> SQLAlchemyExecutionExtraContentRepository:
    """Build a repository backed by the testcontainers database engine."""
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    return SQLAlchemyExecutionExtraContentRepository(sessionmaker(bind=engine, expire_on_commit=False))


@pytest.fixture
def test_scope(db_session_with_containers: Session) -> Generator[_TestScope]:
    """Provide an isolated scope and clean related data after each test."""
    scope = _TestScope()
    _seed_base_entities(db_session_with_containers, scope)
    db_session_with_containers.commit()
    yield scope
    _cleanup_scope_data(db_session_with_containers, scope)


class TestGetByMessageIds:
    """Tests for SQLAlchemyExecutionExtraContentRepository.get_by_message_ids."""

    def test_groups_contents_by_message(
        self,
        db_session_with_containers: Session,
        repository: SQLAlchemyExecutionExtraContentRepository,
        test_scope: _TestScope,
    ) -> None:
        """Submitted forms are correctly mapped and grouped by message ID."""
        workflow_run_id = str(uuid4())
        conversation = _create_conversation(db_session_with_containers, test_scope)
        msg1 = _create_message(db_session_with_containers, test_scope, conversation.id, workflow_run_id)
        msg2 = _create_message(db_session_with_containers, test_scope, conversation.id, workflow_run_id)

        form = _create_submitted_form(
            db_session_with_containers,
            test_scope,
            workflow_run_id=workflow_run_id,
            action_id="approve",
            action_title="Approve",
        )
        _create_human_input_content(
            db_session_with_containers,
            workflow_run_id=workflow_run_id,
            message_id=msg1.id,
            form_id=form.id,
        )
        db_session_with_containers.commit()

        result = repository.get_by_message_ids([msg1.id, msg2.id])

        assert len(result) == 2
        # msg1 has one submitted content
        assert len(result[0]) == 1
        content = result[0][0]
        assert content.submitted is True
        assert content.workflow_run_id == workflow_run_id
        assert content.form_submission_data is not None
        assert content.form_submission_data.action_id == "approve"
        assert content.form_submission_data.action_text == "Approve"
        assert content.form_submission_data.rendered_content == "Rendered Approve"
        assert content.form_submission_data.node_id == "node-id"
        assert content.form_submission_data.node_title == "Approval"
        # msg2 has no content
        assert result[1] == []

    def test_returns_unsubmitted_form_definition(
        self,
        db_session_with_containers: Session,
        repository: SQLAlchemyExecutionExtraContentRepository,
        test_scope: _TestScope,
    ) -> None:
        """Waiting forms return full form_definition with resolved token and defaults."""
        workflow_run_id = str(uuid4())
        conversation = _create_conversation(db_session_with_containers, test_scope)
        msg = _create_message(db_session_with_containers, test_scope, conversation.id, workflow_run_id)

        form = _create_waiting_form(
            db_session_with_containers,
            test_scope,
            workflow_run_id=workflow_run_id,
            default_values={"name": "John"},
        )
        delivery = _create_delivery(db_session_with_containers, form_id=form.id)
        _create_recipient(
            db_session_with_containers,
            form_id=form.id,
            delivery_id=delivery.id,
            access_token="token-1",
        )
        _create_human_input_content(
            db_session_with_containers,
            workflow_run_id=workflow_run_id,
            message_id=msg.id,
            form_id=form.id,
        )
        db_session_with_containers.commit()

        result = repository.get_by_message_ids([msg.id])

        assert len(result) == 1
        assert len(result[0]) == 1
        domain_content = result[0][0]
        assert domain_content.submitted is False
        assert domain_content.workflow_run_id == workflow_run_id
        assert domain_content.form_definition is not None
        form_def = domain_content.form_definition
        assert form_def.form_id == form.id
        assert form_def.node_id == "node-id"
        assert form_def.node_title == "Approval"
        assert form_def.form_content == "Rendered block"
        assert form_def.display_in_ui is True
        assert form_def.form_token == "token-1"
        assert form_def.resolved_default_values == {"name": "John"}
        assert form_def.expiration_time == int(form.expiration_time.timestamp())

    def test_empty_message_ids_returns_empty_list(
        self,
        repository: SQLAlchemyExecutionExtraContentRepository,
    ) -> None:
        """Passing no message IDs returns an empty list without hitting the DB."""
        result = repository.get_by_message_ids([])
        assert result == []
