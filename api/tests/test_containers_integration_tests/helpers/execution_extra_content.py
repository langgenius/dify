from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from core.workflow.nodes.human_input.entities import FormDefinition, UserAction
from models.account import Account, Tenant, TenantAccountJoin
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm, HumanInputFormStatus
from models.model import App, Conversation, Message


@dataclass
class HumanInputMessageFixture:
    app: App
    account: Account
    conversation: Conversation
    message: Message
    form: HumanInputForm
    action_id: str
    action_text: str
    node_title: str


def create_human_input_message_fixture(db_session) -> HumanInputMessageFixture:
    tenant = Tenant(name=f"Tenant {uuid4()}")
    db_session.add(tenant)
    db_session.flush()

    account = Account(
        name=f"Account {uuid4()}",
        email=f"human_input_{uuid4()}@example.com",
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )
    db_session.add(account)
    db_session.flush()

    tenant_join = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role="owner",
        current=True,
    )
    db_session.add(tenant_join)
    db_session.flush()

    app = App(
        tenant_id=tenant.id,
        name=f"App {uuid4()}",
        description="",
        mode="chat",
        icon_type="emoji",
        icon="🤖",
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
    db_session.add(app)
    db_session.flush()

    conversation = Conversation(
        app_id=app.id,
        mode="chat",
        name="Test Conversation",
        summary="",
        introduction="",
        system_instruction="",
        status="normal",
        invoke_from="console",
        from_source="console",
        from_account_id=account.id,
        from_end_user_id=None,
    )
    conversation.inputs = {}
    db_session.add(conversation)
    db_session.flush()

    workflow_run_id = str(uuid4())
    message = Message(
        app_id=app.id,
        conversation_id=conversation.id,
        inputs={},
        query="Human input query",
        message={"messages": []},
        answer="Human input answer",
        message_tokens=50,
        message_unit_price=Decimal("0.001"),
        answer_tokens=80,
        answer_unit_price=Decimal("0.001"),
        provider_response_latency=0.5,
        currency="USD",
        from_source="console",
        from_account_id=account.id,
        workflow_run_id=workflow_run_id,
    )
    db_session.add(message)
    db_session.flush()

    action_id = "approve"
    action_text = "Approve request"
    node_title = "Approval"
    form_definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserAction(id=action_id, title=action_text)],
        rendered_content="Rendered block",
        expiration_time=datetime.utcnow() + timedelta(days=1),
        node_title=node_title,
        display_in_ui=True,
    )
    form = HumanInputForm(
        tenant_id=tenant.id,
        app_id=app.id,
        workflow_run_id=workflow_run_id,
        node_id="node-id",
        form_definition=form_definition.model_dump_json(),
        rendered_content="Rendered block",
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=datetime.utcnow() + timedelta(days=1),
        selected_action_id=action_id,
    )
    db_session.add(form)
    db_session.flush()

    content = HumanInputContent(
        workflow_run_id=workflow_run_id,
        message_id=message.id,
        form_id=form.id,
    )
    db_session.add(content)
    db_session.commit()

    return HumanInputMessageFixture(
        app=app,
        account=account,
        conversation=conversation,
        message=message,
        form=form,
        action_id=action_id,
        action_text=action_text,
        node_title=node_title,
    )
