"""Installed-app suggested questions over real HTTP admission and SQLite services."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from decimal import Decimal
from uuid import uuid4

import pytest
from flask import Blueprint, Flask
from redis import Redis
from sqlalchemy import Connection, Engine, delete, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.explore.message import MessageSuggestedQuestionApi
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, bind_account_loader, load_user_from_request, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account, Tenant
from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, DifySetup, InstalledApp, Message
from models.provider import Provider
from models.workflow import Workflow
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.installed_app_access_service import InstalledAppAccessService
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    installation: InstalledApp
    conversation: Conversation
    message: Message
    factory: sessionmaker[Session]
    admission_factory: sessionmaker[Session]
    sessions: list[Session]

    def get(self, *, installation_id: str | None = None, authenticated: bool = True, csrf: bool = True) -> TestResponse:
        client = self.app.test_client()
        token = generate_csrf_token(self.account.id)
        headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
        if authenticated:
            headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': self.account.id})}"
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
        return client.get(
            f"/installed-apps/{installation_id or self.installation.id}/messages/{self.message.id}/suggested-questions",
            headers=headers,
        )

    def assert_closed(self, *, caller: Session | None = None) -> None:
        assert self.sessions
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.sessions
            if session is not caller
        )


@pytest.fixture
def harness(
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        SECRET_KEY="installed-suggested-questions-test-key",
        LOGIN_DISABLED=False,
        INIT_PASSWORD="",
        CONSOLE_API_URL="http://localhost",
        CONSOLE_WEB_URL="http://localhost",
        COOKIE_DOMAIN="",
    )
    workspace = Tenant(name="Viewer workspace")
    owner = Tenant(name="App owner workspace")
    account = make_account(account_id=str(uuid4()))
    account.last_active_at = naive_utc_now()
    target = make_app(app_id=str(uuid4()), tenant_id=owner.id)
    installation = InstalledApp(
        tenant_id=workspace.id,
        app_id=target.id,
        app_owner_tenant_id=owner.id,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    config = AppModelConfig(app_id=target.id, suggested_questions_after_answer='{"enabled":true}')
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=conversation.id,
        inputs={},
        message={},
        query="How?",
        answer="Like this.",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                owner,
                account,
                target,
                installation,
                config,
                conversation,
                message,
                TenantAccountJoin(
                    tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True
                ),
                DifySetup(version="test"),
                # Real provider ID validation fails before plugin discovery or model I/O.
                Provider(tenant_id=owner.id, provider_name="invalid/provider", is_valid=True),
            ]
        )
        session.flush()
        target.app_model_config_id = config.id
        conversation.app_model_config_id = config.id

    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    admission_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    login_manager = DifyLoginManager()
    login_manager.request_loader(load_user_from_request)
    login_manager.unauthorized_handler(unauthorized_handler)
    login_manager.init_app(app)
    redis_client = Redis()
    redis = RedisClientWrapper()
    redis.initialize(redis_client)
    services = build_application_services(
        database_client=factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )
    # Give the installed-app query its own observable factory for stale-admission tests.
    access = InstalledAppAccessService(
        installed_apps=SQLAlchemyInstalledAppRepository(session_factory=admission_factory),
        is_user_allowed=services.webapp_access.is_user_allowed,
        get_access_modes=services.webapp_access.batch_get_access_modes,
        get_user_permissions=services.webapp_access.batch_get_user_permissions,
    )
    app.extensions["application_services"] = replace(
        services, installed_apps=replace(services.installed_apps, access=access)
    )
    bind_account_loader(app, services.accounts.identity.load_user)
    blueprint = Blueprint("console", __name__)
    api = ExternalApi(blueprint)
    api.add_resource(
        MessageSuggestedQuestionApi,
        "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions",
    )
    app.register_blueprint(blueprint)
    _is_setup_completed.reset_success()
    with app.app_context():
        assert _is_setup_completed()
        db.session.remove()
    sessions: list[Session] = []

    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    factories = (factory, admission_factory, sqlite_session_factory, db.session.session_factory)
    for observed in factories:
        event.listen(observed, "after_begin", track_session)
    yield _Harness(app, account, target, installation, conversation, message, factory, admission_factory, sessions)
    for observed in factories:
        event.remove(observed, "after_begin", track_session)
    assert redis_client.connection_pool._created_connections == 0
    _is_setup_completed.reset_success()
    redis_client.close()
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def _error(response: TestResponse, *, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    body = response.get_json()
    assert body["status"] == status
    assert body["code"] == code


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
def test_owner_provider_resolution_failure_returns_empty_questions(
    harness: _Harness, mode: AppMode, caplog: pytest.LogCaptureFixture
) -> None:
    assert harness.target.tenant_id != harness.installation.tenant_id
    with harness.factory.begin() as session:
        app = session.get(App, harness.target.id)
        assert app is not None
        app.mode = mode
        if mode == AppMode.ADVANCED_CHAT:
            workflow = Workflow.new(
                tenant_id=app.tenant_id,
                app_id=app.id,
                type="chat",
                version="published",
                graph="{}",
                features='{"suggested_questions_after_answer":{"enabled":true}}',
                created_by=harness.account.id,
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )
            session.add(workflow)
            session.flush()
            app.workflow_id = workflow.id
    response = harness.get()
    assert response.status_code == 200
    assert response.get_json() == {"data": []}
    failures = [
        record.exc_info[1]
        for record in caplog.records
        if record.name == "services.message_suggested_questions_generator" and record.exc_info is not None
    ]
    assert len(failures) == 1
    assert isinstance(failures[0], ValueError)
    assert str(failures[0]) == "Invalid plugin id invalid/provider"
    harness.assert_closed()
    with harness.factory() as session:
        installation = session.get(InstalledApp, harness.installation.id)
        assert installation is not None
        assert installation.last_used_at is None


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.AGENT])
def test_non_chat_modes_return_specific_error(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    _error(harness.get(), status=400, code="not_chat_app")
    harness.assert_closed()


@pytest.mark.parametrize("missing", ["installation", "workspace", "app"])
def test_missing_or_foreign_installation_is_rejected(harness: _Harness, missing: str) -> None:
    installation_id = harness.installation.id
    if missing == "installation":
        installation_id = str(uuid4())
    else:
        with harness.factory.begin() as session:
            if missing == "workspace":
                session.execute(
                    update(InstalledApp).where(InstalledApp.id == installation_id).values(tenant_id=str(uuid4()))
                )
            else:
                session.execute(delete(App).where(App.id == harness.target.id))
    _error(harness.get(installation_id=installation_id), status=404, code="installed_app_not_found")
    harness.assert_closed()


@pytest.mark.parametrize("missing", ["login", "csrf"])
def test_real_login_and_csrf_are_required(harness: _Harness, missing: str) -> None:
    response = harness.get(authenticated=missing != "login", csrf=missing != "csrf")
    _error(response, status=401, code="unauthorized")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    if missing == "login":
        assert harness.sessions == []
    else:
        harness.assert_closed()


@pytest.mark.parametrize("model", [Message, Conversation])
@pytest.mark.parametrize("field", ["app_id", "from_account_id", "from_source"])
def test_history_requires_complete_account_ownership(
    harness: _Harness, model: type[Message] | type[Conversation], field: str
) -> None:
    record_id = harness.message.id if model is Message else harness.conversation.id
    value = ConversationFromSource.API if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(model).where(model.id == record_id).values({field: value}))
    _error(harness.get(), status=404, code="message_not_found" if model is Message else "conversation_not_found")
    harness.assert_closed()


@pytest.mark.parametrize("resource", ["message", "conversation", "disabled", "config"])
def test_missing_resources_and_feature_policy_keep_specific_errors(harness: _Harness, resource: str) -> None:
    with harness.factory.begin() as session:
        if resource == "message":
            session.execute(delete(Message).where(Message.id == harness.message.id))
        elif resource == "conversation":
            session.execute(delete(Conversation).where(Conversation.id == harness.conversation.id))
        elif resource == "disabled":
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.app_id == harness.target.id)
                .values(suggested_questions_after_answer='{"enabled":false}')
            )
        else:
            session.execute(delete(AppModelConfig).where(AppModelConfig.app_id == harness.target.id))
    status, code = {
        "message": (404, "message_not_found"),
        "conversation": (404, "conversation_not_found"),
        "disabled": (403, "app_suggested_questions_after_answer_disabled"),
        "config": (500, "internal_server_error"),
    }[resource]
    _error(harness.get(), status=status, code=code)
    harness.assert_closed()


@pytest.mark.parametrize("change", ["mode", "owner", "app", "account"])
def test_stale_admitted_resource_is_revalidated(harness: _Harness, change: str) -> None:
    def change_resource(_session: Session, _transaction: SessionTransaction) -> None:
        with harness.factory.begin() as session:
            if change == "account":
                session.execute(delete(Account).where(Account.id == harness.account.id))
            elif change == "app":
                session.execute(delete(App).where(App.id == harness.target.id))
            else:
                values = {"mode": AppMode.COMPLETION} if change == "mode" else {"tenant_id": str(uuid4())}
                session.execute(update(App).where(App.id == harness.target.id).values(values))

    event.listen(harness.admission_factory, "after_transaction_end", change_resource, once=True)
    try:
        response = harness.get()
    finally:
        event.remove(harness.admission_factory, "after_transaction_end", change_resource)
    _error(
        response,
        status=401 if change == "account" else 400,
        code="unauthorized" if change == "account" else "app_unavailable",
    )
    if change == "account":
        assert response.get_json()["message"] == "Account no longer exists."
    harness.assert_closed()


def test_removed_installation_takes_effect_on_next_request(harness: _Harness) -> None:
    def remove_installation(_session: Session, _transaction: SessionTransaction) -> None:
        with harness.factory.begin() as session:
            session.execute(delete(InstalledApp).where(InstalledApp.id == harness.installation.id))

    event.listen(harness.admission_factory, "after_transaction_end", remove_installation, once=True)
    try:
        response = harness.get()
    finally:
        event.remove(harness.admission_factory, "after_transaction_end", remove_installation)
    assert response.status_code == 200
    assert response.get_json() == {"data": []}
    _error(harness.get(), status=404, code="installed_app_not_found")
    harness.assert_closed()


def test_malformed_config_has_opaque_error(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.app_id == harness.target.id)
            .values(suggested_questions_after_answer="private config diagnostic")
        )
    response = harness.get()
    _error(response, status=500, code="internal_server_error")
    assert "private config diagnostic" not in response.get_data(as_text=True)
    harness.assert_closed()
