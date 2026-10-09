"""Console suggested-question admission and actor/configuration isolation over SQLite."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, delete, event, func, select, text, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.wraps as console_wraps
from controllers.console.app import message as controller
from enums import DeploymentEdition
from extensions.application_services.app import AppServices, build_app_services
from extensions.ext_application_services import _build_oauth_server_service
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from libs import login
from libs.external_api import ExternalApi
from models.account import Account, Tenant
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, DifySetup, Message
from models.provider import Provider
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.message_repository import MessageRepository
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.app.agent_app_service import AgentAppAccessService
from services.entities.message_entities import MessageAccount
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_queries import SuggestedQuestionsQuery
from services.message_suggested_questions_service import (
    MessageSuggestedQuestions,
    MessageSuggestedQuestionsService,
)
from services.recommended_app_package_service import RecommendedAppPackageService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message


@dataclass
class _Agents:
    access: AgentAppAccessService


@dataclass
class _Services:
    apps: AppServices
    agent_apps: _Agents
    message_suggested_questions: MessageSuggestedQuestions


@dataclass
class _Harness:
    flask_app: Flask
    target: App
    account: Account
    conversation: Conversation
    message: Message
    agent_id: str
    factory: sessionmaker[Session]
    services: _Services
    sessions: list[Session]
    queries: SuggestedQuestionsQuery

    def get(self, route: str = "app") -> TestResponse:
        resource = f"apps/{self.target.id}" if route == "app" else f"agent/{self.agent_id}"
        return self.flask_app.test_client().get(f"/{resource}/chat-messages/{self.message.id}/suggested-questions")

    def add_agent(self, *, scope: AgentScope = AgentScope.ROSTER, backing: bool = True) -> None:
        with self.factory.begin() as session:
            session.execute(update(App).where(App.id == self.target.id).values(mode=AppMode.AGENT))
            session.add(
                Agent(
                    id=self.agent_id,
                    tenant_id=self.target.tenant_id,
                    name="Agent",
                    scope=scope,
                    source=AgentSource.AGENT_APP if scope == AgentScope.ROSTER else AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                    app_id=self.target.id if scope == AgentScope.ROSTER else str(uuid4()),
                    backing_app_id=self.target.id if scope == AgentScope.WORKFLOW_ONLY and backing else None,
                    workflow_id=str(uuid4()) if scope == AgentScope.WORKFLOW_ONLY else None,
                    workflow_node_id="node" if scope == AgentScope.WORKFLOW_ONLY else None,
                )
            )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    target = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    account = make_account(account_id=str(uuid4()))
    tenant = Tenant(name="Workspace")
    tenant.id = target.tenant_id
    account._current_tenant = tenant
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        inputs={},
    )
    config = AppModelConfig(
        app_id=target.id, suggested_questions_after_answer=json.dumps({"enabled": True, "prompt": "Console questions"})
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
                target,
                account,
                conversation,
                config,
                message,
                DifySetup(version="test"),
                Provider(tenant_id=target.tenant_id, provider_name="invalid/provider", is_valid=True),
            ]
        )
        session.flush()
        target.app_model_config_id = config.id
        conversation.app_model_config_id = config.id
    sessions: list[Session] = []

    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    event.listen(sqlite_session_factory, "after_begin", track_session)
    monkeypatch.setattr(login, "current_user", account)
    console_wraps._is_setup_completed.reset_success()
    apply_config_overrides(
        monkeypatch, LOGIN_DISABLED=True, RBAC_ENABLED=False, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY
    )
    redis = RedisClientWrapper()
    app_services = build_app_services(
        database_client=sqlite_session_factory,
        oauth=_build_oauth_server_service(database_client=sqlite_session_factory, redis=redis),
        recommended_packages=RecommendedAppPackageService(
            sources=DatabaseRecommendedAppCatalogRepository(sqlite_session_factory, redis=redis),
            exporter=RosterAgentPackageExporter(),
        ),
    )
    flask_app = Flask(__name__)
    flask_app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(flask_app)
    queries = SuggestedQuestionsQuery(
        session_factory=sqlite_session_factory,
        repository=MessageRepository(
            session_factory=sqlite_session_factory,
            extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
        ),
    )
    services = _Services(
        app_services,
        _Agents(AgentAppAccessService(references=AgentAppRepository(session_factory=sqlite_session_factory))),
        MessageSuggestedQuestionsService(queries=queries, generator=SuggestedQuestionsGenerator()),
    )
    flask_app.extensions["application_services"] = services
    api = ExternalApi(flask_app)
    api.add_resource(
        controller.MessageSuggestedQuestionApi,
        "/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions",
    )
    api.add_resource(
        controller.AgentMessageSuggestedQuestionApi,
        "/agent/<uuid:agent_id>/chat-messages/<uuid:message_id>/suggested-questions",
    )
    result = _Harness(
        flask_app,
        target,
        account,
        conversation,
        message,
        str(uuid4()),
        sqlite_session_factory,
        services,
        sessions,
        queries,
    )

    yield result
    event.remove(sqlite_session_factory, "after_begin", track_session)
    console_wraps._is_setup_completed.reset_success()
    with flask_app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT])
def test_model_resolution_failure_keeps_empty_http_success(
    harness: _Harness, mode: AppMode, caplog: pytest.LogCaptureFixture
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    assert response.get_json() == {"data": []}
    assert any(
        record.exc_info
        and isinstance(record.exc_info[1], ValueError)
        and "Invalid plugin id invalid/provider" in str(record.exc_info[1])
        for record in caplog.records
    )
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)


def test_advanced_chat_without_draft_workflow_returns_empty_success(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.ADVANCED_CHAT))
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": []}


@pytest.mark.parametrize("change", ["tenant", "status", "missing", "workflow", "completion", "hidden"])
def test_app_admission_rejects_unavailable_or_unsupported_apps(harness: _Harness, change: str) -> None:
    if change == "hidden":
        harness.add_agent(scope=AgentScope.WORKFLOW_ONLY)
    else:
        field_name, value = {
            "tenant": ("tenant_id", str(uuid4())),
            "status": ("status", "archived"),
            "missing": ("id", str(uuid4())),
            "workflow": ("mode", "workflow"),
            "completion": ("mode", "completion"),
        }[change]
        with harness.factory.begin() as session:
            if change == "status":
                session.execute(
                    text("UPDATE apps SET status = :status WHERE id = :id"), {"status": value, "id": harness.target.id}
                )
            else:
                session.execute(update(App).where(App.id == harness.target.id).values({field_name: value}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_not_found"


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
def test_agent_resolves_existing_backing_app_with_its_debug_configuration(harness: _Harness, scope: AgentScope) -> None:
    harness.add_agent(scope=scope)
    with harness.factory.begin() as session:
        session.add(
            AgentDebugConversation(
                tenant_id=harness.target.tenant_id,
                agent_id=harness.agent_id,
                app_id=harness.target.id,
                account_id=harness.account.id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                conversation_id=harness.conversation.id,
            )
        )
        session.add(
            AgentConfigDraft(
                tenant_id=harness.target.tenant_id,
                agent_id=harness.agent_id,
                account_id=harness.account.id,
                draft_owner_key=harness.account.id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                config_snapshot=AgentSoulConfig.model_validate(
                    {"app_features": {"suggested_questions_after_answer": {"enabled": True}}}
                ),
            )
        )
    response = harness.get("agent")
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": []}
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)


@pytest.mark.parametrize("change", ["missing_backing", "tenant", "agent_status", "app_status", "app_mode"])
def test_agent_rejects_unavailable_runtime_without_creating_app(harness: _Harness, change: str) -> None:
    harness.add_agent(scope=AgentScope.WORKFLOW_ONLY, backing=change != "missing_backing")
    if change != "missing_backing":
        model, key, value = {
            "tenant": (Agent, "tenant_id", str(uuid4())),
            "agent_status": (Agent, "status", AgentStatus.ARCHIVED),
            "app_status": (App, "status", "archived"),
            "app_mode": (App, "mode", AppMode.CHAT),
        }[change]
        with harness.factory.begin() as session:
            if change == "app_status":
                session.execute(
                    text("UPDATE apps SET status = :status WHERE id = :id"), {"status": value, "id": harness.target.id}
                )
            else:
                session.execute(update(model).values({key: value}))
    response = harness.get("agent")
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "agent_not_found_error"
    with harness.factory() as session:
        assert session.scalar(select(func.count()).select_from(App)) == 1
        assert session.scalar(select(func.count()).select_from(AppModelConfig)) == 1
        if change == "missing_backing":
            assert session.scalar(select(Agent.backing_app_id)) is None


@pytest.mark.parametrize("route", ["app", "agent"])
def test_deleted_account_has_explicit_unauthorized_response(harness: _Harness, route: str) -> None:
    if route == "agent":
        harness.add_agent()
    with harness.factory.begin() as session:
        session.execute(delete(Account).where(Account.id == harness.account.id))
    response = harness.get(route)
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.get_json()["message"] == "Account no longer exists"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


def test_disabled_suggestions_have_specific_http_error(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(AppModelConfig).values(suggested_questions_after_answer='{"enabled":false}'))
    response = harness.get()
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "app_suggested_questions_after_answer_disabled"


@pytest.mark.parametrize("route", ["app", "agent"])
def test_missing_published_agent_version_preserves_specific_http_error(harness: _Harness, route: str) -> None:
    harness.add_agent()
    response = harness.get(route)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.headers["Content-Type"] == "application/json"
    assert response.get_json() == {
        "code": "agent_version_not_found_error",
        "message": "Agent config version not found.",
        "status": HTTPStatus.NOT_FOUND,
    }
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)


def test_model_resolution_preserves_pending_caller_session(harness: _Harness) -> None:
    with harness.flask_app.app_context():
        assert console_wraps._is_setup_completed()
        db.session.remove()
        caller_session = db.session()
        caller_app = caller_session.get(App, harness.target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        response = harness.get()
        assert db.session() is caller_session
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": []}


@pytest.mark.parametrize("entity", [Message, Conversation])
@pytest.mark.parametrize("change", ["app_id", "from_account_id", "from_source"])
def test_runtime_cannot_read_another_accounts_message_or_conversation(
    harness: _Harness, entity: type[Message] | type[Conversation], change: str
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(entity).values({change: "api" if change == "from_source" else str(uuid4())}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == ("Message not found" if entity is Message else "Conversation not found")


def test_agent_runtime_uses_current_accounts_personal_debug_draft(harness: _Harness) -> None:
    harness.add_agent()
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values({App.app_model_config_id: None}))
        session.add(
            AgentDebugConversation(
                tenant_id=harness.target.tenant_id,
                agent_id=harness.agent_id,
                app_id=harness.target.id,
                account_id=harness.account.id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                conversation_id=harness.conversation.id,
            )
        )
        for owner, prompt in [(harness.account.id, "My personal draft"), (str(uuid4()), "Other accounts secret draft")]:
            session.add(
                AgentConfigDraft(
                    tenant_id=harness.target.tenant_id,
                    agent_id=harness.agent_id,
                    account_id=owner,
                    draft_owner_key=owner,
                    draft_type=AgentConfigDraftType.DEBUG_BUILD,
                    config_snapshot=AgentSoulConfig.model_validate(
                        {"app_features": {"suggested_questions_after_answer": {"enabled": True, "prompt": prompt}}}
                    ),
                )
            )
    response = harness.get("agent")
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": []}
    context = harness.queries.prepare(
        app_id=harness.target.id,
        app_owner_tenant_id=harness.target.tenant_id,
        expected_app_mode=AppMode.AGENT,
        actor=MessageAccount(harness.account.id),
        invoke_from="debugger",
        message_id=harness.message.id,
    )
    assert context is not None
    assert context.config["prompt"] == "My personal draft"


@pytest.mark.parametrize("same_tenant", [True, False])
def test_agent_runtime_preserves_conversation_binding_scope(harness: _Harness, same_tenant: bool) -> None:
    harness.add_agent()
    draft_id, binding_id = str(uuid4()), str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values({App.app_model_config_id: None}))
        session.add(
            AgentConfigDraft(
                id=draft_id,
                tenant_id=harness.target.tenant_id,
                agent_id=harness.agent_id,
                draft_type=AgentConfigDraftType.DRAFT,
                config_snapshot=AgentSoulConfig.model_validate(
                    {
                        "app_features": {
                            "suggested_questions_after_answer": {
                                "enabled": True,
                                "prompt": "Conversation bound questions",
                            }
                        }
                    }
                ),
            )
        )
        session.add(
            AgentWorkspaceBinding(
                id=binding_id,
                tenant_id=harness.target.tenant_id if same_tenant else str(uuid4()),
                app_id=harness.target.id,
                workspace_id=str(uuid4()),
                agent_id=harness.agent_id,
                agent_config_version_id=draft_id,
                agent_config_version_kind=AgentConfigVersionKind.DRAFT,
                backend_binding_ref="existing-binding",
            )
        )
        session.execute(
            update(Conversation)
            .where(Conversation.id == harness.conversation.id)
            .values({Conversation.agent_workspace_binding_id: binding_id})
        )
    response = harness.get("agent")
    if same_tenant:
        assert response.status_code == HTTPStatus.OK
        context = harness.queries.prepare(
            app_id=harness.target.id,
            app_owner_tenant_id=harness.target.tenant_id,
            expected_app_mode=AppMode.AGENT,
            actor=MessageAccount(harness.account.id),
            invoke_from="debugger",
            message_id=harness.message.id,
        )
        assert context is not None
        assert context.config["prompt"] == "Conversation bound questions"
    else:
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["code"] == "agent_version_not_found_error"
