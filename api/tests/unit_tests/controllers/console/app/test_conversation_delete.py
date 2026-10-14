"""Console conversation deletion through real account admission and SQLite."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACCheck, RBACPermission
from controllers.console.app.conversation import ChatConversationDetailApi, CompletionConversationDetailApi
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from models import Account, Tenant, TenantAccountJoin
from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceOwnerType
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation
from repositories.conversation_repository import ConversationRepository
from services.conversation_command_service import ConversationCommandService
from tests.unit_tests.model_factories import make_account, make_app, make_conversation

type _Kind = Literal["chat", "completion"]


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
    sessions: list[Session] = field(default_factory=list)
    cleanups: list[tuple[str, str, tuple[str, ...]]] = field(default_factory=list)

    def delete(
        self,
        kind: _Kind,
        *,
        app_id: str | None = None,
        conversation_id: str | None = None,
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
        response = client.delete(
            f"/apps/{app_id or self.target.id}/{kind}-conversations/{conversation_id or self.conversation.id}",
            headers=headers,
        )
        self.assert_closed()
        assert response.content_type == "application/json"
        return response

    def assert_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def mode(self, mode: AppMode) -> None:
        with self.factory.begin() as session:
            session.execute(update(App).where(App.id == self.target.id).values(mode=mode))
        self.target.mode = mode

    def assert_unchanged(self, *, previously_deleted: bool = False) -> None:
        with self.factory() as session:
            stored = session.get(Conversation, self.conversation.id)
            assert stored is not None
            assert stored.is_deleted is previously_deleted
            assert stored.read_at is None
            assert stored.read_account_id is None
        assert not self.cleanups


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
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        is_deleted=False,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                target,
                conversation,
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
    state = _Harness(app, sqlite_session_factory, account, tenant, target, conversation)

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

    def enqueue_cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        # Cleanup crosses an external queue boundary only after the real command
        # transaction has closed and its committed deletion is visible.
        state.assert_closed()
        with sqlite_session_factory() as session:
            stored = session.get(Conversation, conversation_id)
            assert stored is not None
            assert stored.is_deleted
            for workspace_id in retired_workspace_ids:
                workspace = session.get(AgentWorkspace, workspace_id)
                assert workspace is not None
                assert workspace.status == AgentWorkingResourceStatus.RETIRED
                assert workspace.active_guard is None
                assert workspace.retired_at is not None
        state.cleanups.append((tenant_id, conversation_id, retired_workspace_ids))

    app.extensions["application_services"] = _Services(
        ConversationCommandService(
            conversations=ConversationRepository(session_factory=factory), enqueue_delete_cleanup=enqueue_cleanup
        )
    )
    api = ExternalApi(app)
    api.add_resource(ChatConversationDetailApi, "/apps/<uuid:app_id>/chat-conversations/<uuid:conversation_id>")
    api.add_resource(
        CompletionConversationDetailApi, "/apps/<uuid:app_id>/completion-conversations/<uuid:conversation_id>"
    )
    yield state
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize(
    ("kind", "mode"),
    [
        ("completion", AppMode.COMPLETION),
        ("chat", AppMode.CHAT),
        ("chat", AppMode.AGENT_CHAT),
        ("chat", AppMode.ADVANCED_CHAT),
        ("chat", AppMode.AGENT),
    ],
)
def test_delete_commits_retirement_before_cleanup_and_returns_empty_204(
    harness: _Harness, kind: _Kind, mode: AppMode
) -> None:
    harness.mode(mode)
    with harness.factory.begin() as session:
        workspace = AgentWorkspace(
            id=str(uuid4()),
            tenant_id=harness.target.tenant_id,
            app_id=harness.target.id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=harness.conversation.id,
            owner_scope_key="chatflow-node",
            backend_workspace_ref="backend-workspace",
            status=AgentWorkingResourceStatus.ACTIVE,
            active_guard=1,
        )
        session.add(workspace)

    response = harness.delete(kind)

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""
    assert "Content-Length" not in response.headers
    assert harness.cleanups == [(harness.tenant.id, harness.conversation.id, (workspace.id,))]
    assert harness.sessions
    with harness.factory() as session:
        stored = session.get(Conversation, harness.conversation.id)
        assert stored is not None
        assert stored.read_at is None
        assert stored.read_account_id is None

    repeated = harness.delete(kind)
    assert repeated.status_code == HTTPStatus.NOT_FOUND
    assert repeated.get_json()["code"] == "conversation_not_found"
    assert len(harness.cleanups) == 1


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize("field", ["app_id", "from_source", "from_account_id", "from_end_user_id", "is_deleted"])
def test_delete_cannot_target_another_conversation_owner(harness: _Harness, kind: _Kind, field: str) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    value: str | bool
    if field == "is_deleted":
        value = True
    elif field == "from_source":
        value = ConversationFromSource.API
    elif field == "from_end_user_id":
        # Account and EndUser IDs remain different owner namespaces even if equal.
        value = harness.account.id
    else:
        value = str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values({field: value}))
    response = harness.delete(kind)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    harness.assert_unchanged(previously_deleted=field == "is_deleted")


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_missing_conversation_does_not_delete_existing_conversation(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    response = harness.delete(kind, conversation_id=str(uuid4()))
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    harness.assert_unchanged()


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize("unavailable", ["missing", "other_tenant"])
def test_app_scope_is_checked_before_delete(harness: _Harness, kind: _Kind, unavailable: str) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        if unavailable == "missing":
            session.delete(target)
        else:
            target.tenant_id = str(uuid4())
    response = harness.delete(kind)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_not_found"
    harness.assert_unchanged()


@pytest.mark.parametrize(
    ("kind", "mode"),
    [("chat", AppMode.COMPLETION), ("chat", AppMode.WORKFLOW), ("completion", AppMode.CHAT)],
)
def test_unsupported_app_mode_cannot_delete_conversation(harness: _Harness, kind: _Kind, mode: AppMode) -> None:
    harness.mode(mode)
    response = harness.delete(kind)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_not_found"
    harness.assert_unchanged()


@pytest.mark.parametrize("kind", ["chat", "completion"])
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
def test_existing_edit_roles_are_preserved(harness: _Harness, kind: _Kind, role: TenantAccountRole) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    with harness.factory.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id))
        assert membership is not None
        membership.role = role
    response = harness.delete(kind)
    if TenantAccountRole.is_editing_role(role):
        assert response.status_code == HTTPStatus.NO_CONTENT
        assert len(harness.cleanups) == 1
    else:
        assert response.status_code == HTTPStatus.FORBIDDEN
        harness.assert_unchanged()


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_login_and_csrf_remain_required(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    assert harness.delete(kind, authenticated=False).status_code == HTTPStatus.UNAUTHORIZED
    assert harness.delete(kind, csrf=False).status_code == HTTPStatus.UNAUTHORIZED
    harness.assert_unchanged()


@pytest.mark.parametrize("handler", [ChatConversationDetailApi.delete, CompletionConversationDetailApi.delete])
def test_app_edit_rbac_check_is_declared(handler: Callable[..., object]) -> None:
    checks: tuple[RBACCheck, ...] = vars(handler)[RBAC_CHECKS_ATTR]
    assert len(checks) == 1
    assert checks[0].scene == RBACPermission.APP_EDIT
    assert isinstance(checks[0].locator, PlainApp)
    assert checks[0].locator.param == "app_id"
