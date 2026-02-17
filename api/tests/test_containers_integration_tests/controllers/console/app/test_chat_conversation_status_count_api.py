"""TestContainers integration tests for ChatConversationApi status_count behavior."""

import json
import uuid

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from configs import dify_config
from constants import HEADER_NAME_CSRF_TOKEN
from core.workflow.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.enums import CreatorUserRole
from models.model import App, AppMode, Conversation, Message
from models.workflow import WorkflowRun
from services.account_service import AccountService


def _create_account_and_tenant(db_session: Session) -> tuple[Account, Tenant]:
    account = Account(
        email=f"test-{uuid.uuid4()}@example.com",
        name="Test User",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    account.initialized_at = naive_utc_now()
    db_session.add(account)
    db_session.commit()

    tenant = Tenant(name="Test Tenant", status="normal")
    db_session.add(tenant)
    db_session.commit()

    join = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.OWNER,
        current=True,
    )
    db_session.add(join)
    db_session.commit()

    account.set_tenant_id(tenant.id)
    account.timezone = "UTC"
    db_session.commit()

    dify_setup = DifySetup(version=dify_config.project.version)
    db_session.add(dify_setup)
    db_session.commit()

    return account, tenant


def _create_app(db_session: Session, tenant_id: str, account_id: str) -> App:
    app = App(
        tenant_id=tenant_id,
        name="Test Chat App",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
        created_by=account_id,
    )
    db_session.add(app)
    db_session.commit()
    return app


def _create_conversation(db_session: Session, app_id: str, account_id: str) -> Conversation:
    conversation = Conversation(
        app_id=app_id,
        name="Test Conversation",
        inputs={},
        status="normal",
        mode=AppMode.CHAT,
        from_source=CreatorUserRole.ACCOUNT,
        from_account_id=account_id,
    )
    db_session.add(conversation)
    db_session.commit()
    return conversation


def _create_workflow_run(db_session: Session, app_id: str, tenant_id: str, account_id: str) -> WorkflowRun:
    workflow_run = WorkflowRun(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=str(uuid.uuid4()),
        type="chat",
        triggered_from="app-run",
        version="1.0.0",
        graph=json.dumps({"nodes": [], "edges": []}),
        inputs=json.dumps({"query": "test"}),
        status=WorkflowExecutionStatus.PAUSED,
        outputs=json.dumps({}),
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=naive_utc_now(),
    )
    db_session.add(workflow_run)
    db_session.commit()
    return workflow_run


def _create_message(
    db_session: Session, app_id: str, conversation_id: str, workflow_run_id: str, account_id: str
) -> Message:
    message = Message(
        app_id=app_id,
        conversation_id=conversation_id,
        query="Hello",
        message={"type": "text", "content": "Hello"},
        answer="Hi there",
        message_tokens=1,
        answer_tokens=1,
        message_unit_price=0.001,
        answer_unit_price=0.001,
        message_price_unit=0.001,
        answer_price_unit=0.001,
        currency="USD",
        status="normal",
        from_source=CreatorUserRole.ACCOUNT,
        from_account_id=account_id,
        workflow_run_id=workflow_run_id,
        inputs={"query": "Hello"},
    )
    db_session.add(message)
    db_session.commit()
    return message


def test_chat_conversation_status_count_includes_paused(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
):
    account, tenant = _create_account_and_tenant(db_session_with_containers)
    app = _create_app(db_session_with_containers, tenant.id, account.id)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id)
    conversation_id = conversation.id
    workflow_run = _create_workflow_run(db_session_with_containers, app.id, tenant.id, account.id)
    _create_message(db_session_with_containers, app.id, conversation.id, workflow_run.id, account.id)

    access_token = AccountService.get_account_jwt_token(account)
    csrf_token = generate_csrf_token(account.id)
    cookie_name = _real_cookie_name("csrf_token")

    test_client_with_containers.set_cookie(cookie_name, csrf_token, domain="localhost")
    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/chat-conversations",
        headers={
            "Authorization": f"Bearer {access_token}",
            HEADER_NAME_CSRF_TOKEN: csrf_token,
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["total"] == 1
    assert payload["data"][0]["id"] == conversation_id
    assert payload["data"][0]["status_count"]["paused"] == 1
