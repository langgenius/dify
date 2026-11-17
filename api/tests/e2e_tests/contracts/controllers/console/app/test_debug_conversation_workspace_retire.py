"""Chatflow debug workspace retirement through real account admission and SQLite."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACCheck, RBACPermission
from controllers.console.app.conversation import AdvancedChatDebugConversationWorkspacesRetireApi
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from models import Account, Tenant, TenantAccountJoin
from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceOwnerType
from models.enums import ConversationFromSource, InvokeFrom
from models.model import App, AppMode, Conversation
from repositories.conversation_repository import ConversationRepository
from services.conversation_command_service import ConversationCommandService
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation

_ROUTE = "/apps/<uuid:app_id>/advanced-chat/workflows/draft/conversations/workspaces/retire"


def _unexpected_delete_cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
    raise AssertionError(f"No deletion cleanup expected: {tenant_id} {conversation_id} {retired_workspace_ids}")


@dataclass(frozen=True)
class _Services:
    conversation_commands: ConversationCommandService


@dataclass
class _Harness:
    app: Flask
    factory: sessionmaker[Session]
    account: Account
    tenant: Tenant
    target: App
    conversation: Conversation
    workspace_id: str
    sessions: list[Session] = field(default_factory=list)
    collections: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)

    def retire(
        self,
        *,
        app_id: str | None = None,
        authenticated: bool = True,
        csrf: bool = True,
    ) -> TestResponse:
        client = self.app.test_client()
        headers: dict[str, str] = {}
        if authenticated:
            with client.session_transaction() as session:
                session["_user_id"] = self.account.id
                session["_fresh"] = True
            if csrf:
                token = generate_csrf_token(self.account.id)
                client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
                headers[HEADER_NAME_CSRF_TOKEN] = token
        response = client.post(
            f"/apps/{app_id or self.target.id}/advanced-chat/workflows/draft/conversations/workspaces/retire",
            headers=headers,
        )
        self.assert_closed()
        assert response.content_type == "application/json"
        return response

    def assert_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def assert_unchanged(self) -> None:
        with self.factory() as session:
            assert session.get_one(Conversation, self.conversation.id).is_deleted is False
            assert session.get_one(AgentWorkspace, self.workspace_id).status == AgentWorkingResourceStatus.ACTIVE
        assert not self.collections


@pytest.fixture
def harness(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None]
) -> Iterator[_Harness]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=False,
        RBAC_ENABLED=False,
        SECRET_KEY="conversation-http-tests-key-at-least-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        COOKIE_DOMAIN="",
    )
    tenant = Tenant(name="Console workspace")
    account = make_account(account_id=str(uuid4()), timezone="UTC")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.ADVANCED_CHAT)
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        mode=AppMode.ADVANCED_CHAT,
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        invoke_from=InvokeFrom.DEBUGGER,
        is_deleted=False,
    )
    workspace = AgentWorkspace(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=target.id,
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id=conversation.id,
        owner_scope_key="chatflow-node",
        backend_workspace_ref="backend-workspace",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                target,
                conversation,
                workspace,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )
    app = Flask(__name__)
    app.config.update(
        TESTING=True,
        RESTX_ERROR_404_HELP=False,
        SECRET_KEY="console-test-session",
        SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url),
    )
    db.init_app(app)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)
    state = _Harness(app, sqlite_session_factory, account, tenant, target, conversation, workspace.id)

    @login_manager.user_loader
    def load_account(account_id: str) -> Account | None:
        with sqlite_session_factory() as session:
            loaded = session.get(Account, account_id)
            if loaded is not None:
                loaded.set_tenant_id_with_session(tenant.id, session=session)
        return loaded

    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    @event.listens_for(factory, "after_begin")
    def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        state.assert_closed()
        state.sessions.append(session)

    def collect_agent_workspaces(*, tenant_id: str, agent_workspace_ids: tuple[str, ...]) -> None:
        # Collection destroys sandboxes, so it may only see committed retirement.
        state.assert_closed()
        with sqlite_session_factory() as session:
            for workspace_id in agent_workspace_ids:
                stored = session.get_one(AgentWorkspace, workspace_id)
                assert stored.status == AgentWorkingResourceStatus.RETIRED
                assert stored.active_guard is None
        state.collections.append((tenant_id, agent_workspace_ids))

    app.extensions["application_services"] = _Services(
        ConversationCommandService(
            conversations=ConversationRepository(session_factory=factory),
            enqueue_delete_cleanup=_unexpected_delete_cleanup,
            collect_agent_workspaces=collect_agent_workspaces,
        )
    )
    api = ExternalApi(app)
    api.add_resource(AdvancedChatDebugConversationWorkspacesRetireApi, _ROUTE)
    yield state
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_retire_commits_before_collection_keeps_conversation_and_is_idempotent(harness: _Harness) -> None:
    response = harness.retire()

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""
    assert harness.collections == [(harness.tenant.id, (harness.workspace_id,))]
    with harness.factory() as session:
        assert session.get_one(Conversation, harness.conversation.id).is_deleted is False

    repeated = harness.retire()
    assert repeated.status_code == HTTPStatus.NO_CONTENT
    assert len(harness.collections) == 1


def test_retire_covers_debug_sessions_the_client_lost_on_refresh(harness: _Harness) -> None:
    earlier = make_conversation(
        conversation_id=str(uuid4()),
        app_id=harness.target.id,
        mode=AppMode.ADVANCED_CHAT,
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=harness.account.id,
        invoke_from=InvokeFrom.DEBUGGER,
        is_deleted=False,
    )
    earlier_workspace = AgentWorkspace(
        id=str(uuid4()),
        tenant_id=harness.tenant.id,
        app_id=harness.target.id,
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id=earlier.id,
        owner_scope_key="chatflow-node",
        backend_workspace_ref="earlier-backend-workspace",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    with harness.factory.begin() as session:
        session.add_all([earlier, earlier_workspace])

    assert harness.retire().status_code == HTTPStatus.NO_CONTENT

    assert len(harness.collections) == 1
    tenant_id, agent_workspace_ids = harness.collections[0]
    assert tenant_id == harness.tenant.id
    assert set(agent_workspace_ids) == {harness.workspace_id, earlier_workspace.id}


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("from_account_id", "other-account"),
        ("from_source", ConversationFromSource.API),
        ("invoke_from", InvokeFrom.EXPLORE),
        ("is_deleted", True),
    ],
)
def test_retire_leaves_conversations_that_are_not_the_callers_debug_sessions(
    harness: _Harness, column: str, value: object
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values({column: value}))
    response = harness.retire()
    assert response.status_code == HTTPStatus.NO_CONTENT
    with harness.factory() as session:
        assert session.get_one(AgentWorkspace, harness.workspace_id).status == AgentWorkingResourceStatus.ACTIVE
    assert not harness.collections


@pytest.mark.parametrize("unavailable", ["missing", "other_tenant", "chat_mode"])
def test_retire_checks_app_scope_and_mode(harness: _Harness, unavailable: str) -> None:
    with harness.factory.begin() as session:
        target = session.get_one(App, harness.target.id)
        if unavailable == "missing":
            session.delete(target)
        elif unavailable == "other_tenant":
            target.tenant_id = str(uuid4())
        else:
            target.mode = AppMode.CHAT
    response = harness.retire()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_not_found"
    harness.assert_unchanged()


@pytest.mark.parametrize(
    "role",
    [
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
        TenantAccountRole.NORMAL,
        TenantAccountRole.DATASET_OPERATOR,
    ],
)
def test_retire_requires_an_editing_role(harness: _Harness, role: TenantAccountRole) -> None:
    with harness.factory.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id))
        assert membership is not None
        membership.role = role
    response = harness.retire()
    if TenantAccountRole.is_editing_role(role):
        assert response.status_code == HTTPStatus.NO_CONTENT
        assert len(harness.collections) == 1
    else:
        assert response.status_code == HTTPStatus.FORBIDDEN
        harness.assert_unchanged()


def test_retire_requires_login_and_csrf(harness: _Harness) -> None:
    assert harness.retire(authenticated=False).status_code == HTTPStatus.UNAUTHORIZED
    assert harness.retire(csrf=False).status_code == HTTPStatus.UNAUTHORIZED
    harness.assert_unchanged()


def test_retire_declares_app_test_and_run_rbac_check() -> None:
    checks: tuple[RBACCheck, ...] = vars(AdvancedChatDebugConversationWorkspacesRetireApi.post)[RBAC_CHECKS_ATTR]
    assert len(checks) == 1
    assert checks[0].scene == RBACPermission.APP_TEST_AND_RUN
    assert isinstance(checks[0].locator, PlainApp)
    assert checks[0].locator.param == "app_id"
