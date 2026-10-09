"""Trial suggested questions through HTTP, real ownership queries, and SQLite."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, delete, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.explore.trial as trial_module
import controllers.console.wraps as console_wraps
import libs.login as login_module
from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from core.memory.token_buffer_memory import PreparedHistory
from enums import DeploymentEdition
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from models import Account, AccountTrialAppRecord, App, AppMode, Conversation, Message, Tenant, TrialApp
from models.account import AccountStatus
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import ConversationFromSource
from models.model import AppModelConfig, DifySetup
from models.provider import Provider
from repositories.message_repository import MessageRepository
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from repositories.trial_app_repository import TrialAppRepository
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_queries import SuggestedQuestionsQuery
from services.message_suggested_questions_service import (
    MessageSuggestedQuestionsService,
)
from services.recommended_app_query_service import RecommendedAppQueryService
from services.trial_app_access_service import TrialAppAccessService


@dataclass(frozen=True)
class _TrialAppServices:
    access: TrialAppAccessService


@dataclass(frozen=True)
class _ApplicationServices:
    trial_apps: _TrialAppServices
    recommended_app_queries: RecommendedAppQueryService
    message_suggested_questions: MessageSuggestedQuestionsService[PreparedHistory]


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    trial: TrialApp
    conversation: Conversation
    message: Message
    config: AppModelConfig
    factory: sessionmaker[Session]
    features: RecommendedAppQueryService
    read_sessions: list[Session]
    legacy_sessions: list[Session]

    def get(self, *, app_id: str | None = None, message_id: str | None = None) -> TestResponse:
        client = self.app.test_client()
        csrf = generate_csrf_token(self.account.id)
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, csrf)
        return client.get(
            f"/trial-apps/{app_id or self.target.id}/messages/{message_id or self.message.id}/suggested-questions",
            headers={HEADER_NAME_CSRF_TOKEN: csrf},
        )

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.read_sessions + self.legacy_sessions
        )

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> Iterator[_Harness]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        INIT_PASSWORD="",
        LOGIN_DISABLED=False,
        RBAC_ENABLED=False,
        SECRET_KEY="trial-suggested-question-test-secret",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        COOKIE_DOMAIN="",
    )
    console_wraps._is_setup_completed.reset_success()
    account = Account(name="Trial viewer", email="trial@example.com")
    account._current_tenant = Tenant(name="Viewer workspace")
    target = App(tenant_id=str(uuid4()), name="Trial app", mode=AppMode.CHAT, enable_site=True, enable_api=False)
    target.id = str(uuid4())
    trial = TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=3)
    config = AppModelConfig(
        app_id=target.id,
        suggested_questions_after_answer='{"enabled":true,"prompt":"Suggest concise follow-ups"}',
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                account,
                target,
                trial,
                config,
                DifySetup(version="test"),
                Provider(tenant_id=target.tenant_id, provider_name="invalid/provider", is_valid=True),
            ]
        )
        session.flush()
        target.app_model_config_id = config.id
        conversation = Conversation(
            app_id=target.id,
            app_model_config_id=config.id,
            mode=AppMode.CHAT,
            name="Trial conversation",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account.id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=target.id,
            conversation_id=conversation.id,
            inputs={},
            query="What is a trial?",
            message={},
            message_unit_price=Decimal(0),
            answer="A way to try an app.",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account.id,
        )
        session.add(message)

    read_sessions: list[Session] = []
    read_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    @event.listens_for(read_factory, "after_begin")
    def track_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        read_sessions.append(session)

    trial_apps = TrialAppRepository(session_factory=read_factory)
    features = RecommendedAppQueryService(
        catalog=DatabaseRecommendedAppCatalogRepository(read_factory, redis=RedisClientWrapper()),
        trial_apps=trial_apps,
        trial_enabled=True,
    )
    queries = SuggestedQuestionsQuery(
        session_factory=read_factory,
        repository=MessageRepository(
            session_factory=read_factory,
        ),
    )
    services = _ApplicationServices(
        trial_apps=_TrialAppServices(access=TrialAppAccessService(apps=trial_apps)),
        recommended_app_queries=features,
        message_suggested_questions=MessageSuggestedQuestionsService(
            queries=queries, generator=SuggestedQuestionsGenerator()
        ),
    )

    monkeypatch.setattr(login_module, "current_user", account)

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    app.extensions["application_services"] = services
    legacy_sessions: list[Session] = []

    def track_legacy(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        legacy_sessions.append(session)

    event.listen(db.session.session_factory, "after_begin", track_legacy)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)
    api = ExternalApi(app)
    api.add_resource(
        trial_module.TrialMessageSuggestedQuestionApi,
        "/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions",
    )
    yield _Harness(
        app,
        account,
        target,
        trial,
        conversation,
        message,
        config,
        sqlite_session_factory,
        features,
        read_sessions,
        legacy_sessions,
    )
    event.remove(db.session.session_factory, "after_begin", track_legacy)
    console_wraps._is_setup_completed.reset_success()
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def _assert_error(response: TestResponse, status: int, code: str, message: str | None = None) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert body["message"]
    if message is not None:
        assert body["message"] == message
    assert response.headers["Content-Type"] == "application/json"


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.AGENT])
def test_model_resolution_failure_keeps_empty_response_and_usage(
    harness: _Harness, mode: AppMode, caplog: pytest.LogCaptureFixture
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(mode=mode))
        session.add_all(
            [
                AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=1),
                AccountTrialAppRecord(app_id=harness.target.id, account_id=str(uuid4()), count=3),
            ]
        )
    response = harness.get()
    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {"data": []}
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    assert any(
        record.exc_info
        and isinstance(record.exc_info[1], ValueError)
        and "Invalid plugin id invalid/provider" in str(record.exc_info[1])
        for record in caplog.records
    )
    assert harness.target.tenant_id not in {harness.trial.tenant_id, harness.account.current_tenant_id}
    assert harness.usage() == 1
    harness.assert_closed()


def test_missing_published_agent_version_has_specific_error(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.AGENT))
        session.add(
            Agent(
                tenant_id=harness.target.tenant_id,
                app_id=harness.target.id,
                name="Trial Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                status=AgentStatus.ACTIVE,
            )
        )

    _assert_error(harness.get(), 404, "agent_version_not_found_error", "Agent config version not found.")
    assert harness.usage() is None
    harness.assert_closed()


@pytest.mark.parametrize("entity", ["message", "conversation"])
@pytest.mark.parametrize("mismatch", ["missing", "app", "account", "source", "end-user"])
def test_message_and_conversation_require_complete_owner_chain(harness: _Harness, entity: str, mismatch: str) -> None:
    message_id = harness.message.id
    with harness.factory.begin() as session:
        record = (
            session.get(Message, harness.message.id)
            if entity == "message"
            else session.get(Conversation, harness.conversation.id)
        )
        assert record is not None
        match mismatch:
            case "missing":
                if entity == "message":
                    message_id = str(uuid4())
                else:
                    session.delete(record)
            case "app":
                record.app_id = str(uuid4())
            case "account":
                record.from_account_id = str(uuid4())
            case "source":
                record.from_source = ConversationFromSource.API
            case "end-user":
                record.from_end_user_id = str(uuid4())

    response = harness.get(message_id=message_id)

    _assert_error(response, 404, "not_found", "Message not found" if entity == "message" else "Conversation not found")
    assert harness.usage() is None
    harness.assert_closed()


def test_deleted_conversation_is_not_visible(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(is_deleted=True))
    _assert_error(harness.get(), 404, "not_found", "Conversation not found")
    harness.assert_closed()


@pytest.mark.parametrize("config", [None, '{"enabled":false}'])
def test_disabled_or_unset_suggestions_have_specific_error(harness: _Harness, config: str | None) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(suggested_questions_after_answer=config)
        )
    _assert_error(harness.get(), 403, "app_suggested_questions_after_answer_disabled")
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_unsupported_app_modes_fail_before_runtime(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    _assert_error(harness.get(), 400, "not_chat_app")
    assert len(harness.read_sessions) == 1
    harness.assert_closed()


@pytest.mark.parametrize(
    ("denial", "status", "code"),
    [
        ("setup", 401, "not_setup"),
        ("feature", 403, "trial_app_feature_disabled"),
        ("missing_trial", 403, "trial_app_not_allowed"),
        ("missing_app", 403, "trial_app_not_allowed"),
        ("quota", 403, "trial_app_limit_exceeded"),
        ("uninitialized", 400, "account_not_initialized"),
        ("unauthenticated", 401, "unauthorized"),
    ],
)
def test_admission_blocks_before_runtime(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, denial: str, status: int, code: str
) -> None:
    if denial == "setup":
        with harness.factory.begin() as session:
            session.execute(delete(DifySetup))
        console_wraps._is_setup_completed.reset_success()
    elif denial == "feature":
        harness.features._trial_enabled = False
    elif denial == "uninitialized":
        harness.account.status = AccountStatus.UNINITIALIZED
    elif denial == "unauthenticated":
        monkeypatch.setattr(login_module, "current_user", None)
    else:
        with harness.factory.begin() as session:
            if denial == "missing_trial":
                session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
            elif denial == "missing_app":
                session.execute(delete(App).where(App.id == harness.target.id))
            else:
                session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
    response = harness.get()
    if denial == "unauthenticated":
        assert response.status_code == 401
        assert response.get_json() == {"code": "unauthorized", "message": "Unauthorized."}
    else:
        _assert_error(response, status, code)
    harness.assert_closed()


def test_model_resolution_preserves_outer_request_session(harness: _Harness) -> None:
    with harness.app.app_context():
        # Bootstrap uses the scoped session; complete that real query before the caller edits its entity.
        assert console_wraps._is_setup_completed()
        db.session.remove()
        outer_session = db.session()
        app_model = outer_session.get(App, harness.target.id)
        assert app_model is not None
        app_model.name = "Pending caller change"
        response = harness.get()
        assert response.status_code == 200
        assert db.session() is outer_session
        assert outer_session.in_transaction()
        assert app_model in outer_session.dirty
        assert app_model.name == "Pending caller change"
    harness.assert_closed()
    with harness.factory() as session:
        saved_app = session.get(App, harness.target.id)
        assert saved_app is not None
        assert saved_app.name == "Trial app"


def test_advanced_chat_without_published_workflow_keeps_empty_success(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.ADVANCED_CHAT))
    response = harness.get()
    assert response.status_code == 200
    assert response.get_json() == {"data": []}
    assert len(harness.read_sessions) == 2
    assert harness.usage() is None
    harness.assert_closed()


def test_deleted_account_has_explicit_unauthorized_response(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Account).where(Account.id == harness.account.id))
    response = harness.get()
    _assert_error(response, 401, "unauthorized", "Account no longer exists.")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert harness.usage() is None
    harness.assert_closed()
