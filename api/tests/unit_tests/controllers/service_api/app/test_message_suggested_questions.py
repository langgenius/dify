"""Service API suggested questions with real admission, end-user provisioning, and SQLite."""

from collections.abc import Iterator
from dataclasses import FrozenInstanceError, asdict, dataclass
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from flask_login import LoginManager, current_user
from sqlalchemy import Connection, Engine, event, select, text
from sqlalchemy.orm import Session, SessionTransaction, object_session, sessionmaker
from werkzeug.test import TestResponse

from controllers.service_api.app.message import MessageSuggestedApi
from controllers.service_api.flask_admission import service_api_end_user_admission
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from extensions.ext_database import db
from libs.external_api import ExternalApi
from machinery.context import ServiceApiEndUserContext
from models import Tenant, TenantStatus
from models.agent import Agent, AgentScope, AgentSource
from models.enums import ConversationFromSource, EndUserType
from models.model import ApiToken, App, AppMode, AppModelConfig, Conversation, EndUser, Message
from models.provider import Provider
from models.workflow import Workflow, WorkflowType
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from repositories.message_repository import MessageRepository
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.app_definition_query_service import AppDefinitionQueryService, AppDefinitionUnavailableError
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.errors.app import AppAbnormalStatusError, AppApiDisabledError
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_queries import SuggestedQuestionsQuery
from services.message_suggested_questions_service import (
    MessageSuggestedQuestions,
    MessageSuggestedQuestionsService,
)
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass(frozen=True)
class _EndUsers:
    commands: AppScopedEndUserService[EndUser]


@dataclass(frozen=True)
class _Services:
    app_definitions: AppDefinitionQueryService
    message_suggested_questions: MessageSuggestedQuestions
    app_scoped_end_users: _EndUsers


@dataclass(frozen=True)
class _Harness:
    app: Flask
    target: App
    tenant: Tenant
    end_user: EndUser
    conversation: Conversation
    config: AppModelConfig
    provision_factory: sessionmaker[Session]
    factory: sessionmaker[Session]
    message_id: str
    admissions: list[Session]
    provisions: list[Session]
    queries: list[Session]
    scoped_sessions: list[Session]

    def get(self, *, user: str | None = "alice", authorization: str | None = "Bearer test-token") -> TestResponse:
        headers: dict[str, str] = {"Authorization": authorization} if authorization is not None else {}
        query: dict[str, str] = {"user": user} if user is not None else {}
        return self.app.test_client().get(f"/messages/{self.message_id}/suggested", query_string=query, headers=headers)

    def assert_closed(self, *, caller: Session | None = None) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.admissions + self.provisions + self.queries + self.scoped_sessions
            if session is not caller
        )


@pytest.fixture
def harness(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    tenant = Tenant(name="API workspace")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    end_user = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=target.id,
        end_user_type=EndUserType.SERVICE_API,
        session_id="alice",
        external_user_id="alice",
    )
    config = AppModelConfig(app_id=target.id, suggested_questions_after_answer='{"enabled": true}')
    config.id = str(uuid4())
    target.app_model_config_id = config.id
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    conversation.app_model_config_id = config.id
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=conversation.id,
        inputs={},
        query="How does this work?",
        message={},
        answer="Like this.",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    token = ApiToken(app_id=target.id, tenant_id=tenant.id, type="app", token="test-token")
    with sqlite_session_factory.begin() as session:
        # Fail the actual provider ID validation before plugin discovery can run.
        provider = Provider(tenant_id=tenant.id, provider_name="invalid/provider", is_valid=True)
        session.add_all([tenant, target, end_user, config, conversation, message, token, provider])

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    LoginManager(app)
    admissions: list[Session] = []
    provisions: list[Session] = []
    query_sessions: list[Session] = []
    scoped_sessions: list[Session] = []
    admission_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    provision_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    query_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    def track_admission(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        admissions.append(session)

    def track_provision(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        # End-user lookup/creation must not overlap the admission transaction.
        assert all(not admission.in_transaction() and not admission.identity_map for admission in admissions)
        provisions.append(session)

    def track_query(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        query_sessions.append(session)

    def track_scoped(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        scoped_sessions.append(session)

    event.listen(admission_factory, "after_begin", track_admission)
    event.listen(provision_factory, "after_begin", track_provision)
    event.listen(query_factory, "after_begin", track_query)
    event.listen(db.session.session_factory, "after_begin", track_scoped)

    queries = SuggestedQuestionsQuery(
        session_factory=query_factory,
        repository=MessageRepository(
            session_factory=query_factory,
            extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=query_factory),
        ),
    )
    service = MessageSuggestedQuestionsService(queries=queries, generator=SuggestedQuestionsGenerator())
    app.extensions["application_services"] = _Services(
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=admission_factory), builtin_icon_url_prefix=""
        ),
        message_suggested_questions=service,
        app_scoped_end_users=_EndUsers(
            AppScopedEndUserService(end_users=AppScopedEndUserRepo(session_factory=provision_factory))
        ),
    )
    api = ExternalApi(app)
    api.add_resource(MessageSuggestedApi, "/messages/<uuid:message_id>/suggested")
    yield _Harness(
        app,
        target,
        tenant,
        end_user,
        conversation,
        config,
        provision_factory,
        sqlite_session_factory,
        message.id,
        admissions,
        provisions,
        query_sessions,
        scoped_sessions,
    )
    event.remove(admission_factory, "after_begin", track_admission)
    event.remove(provision_factory, "after_begin", track_provision)
    event.remove(query_factory, "after_begin", track_query)
    event.remove(db.session.session_factory, "after_begin", track_scoped)
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_admitted_identity_and_mode_return_empty_questions_for_invalid_provider_config(
    harness: _Harness, mode: AppMode, caplog: pytest.LogCaptureFixture
) -> None:
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        target.mode = mode
        if mode == AppMode.ADVANCED_CHAT:
            workflow = Workflow(
                tenant_id=harness.tenant.id,
                app_id=target.id,
                type=WorkflowType.CHAT,
                version="published",
                graph='{"nodes":[],"edges":[]}',
                features='{"suggested_questions_after_answer":{"enabled":true}}',
                created_by=str(uuid4()),
            )
            session.add(workflow)
            session.flush()
            target.workflow_id = workflow.id
    response = harness.get()
    assert response.status_code == 200
    assert response.json == {"result": "success", "data": []}
    assert response.headers["Content-Type"] == "application/json"
    failures = [
        record.exc_info[1]
        for record in caplog.records
        if record.name == "services.message_suggested_questions_generator" and record.exc_info is not None
    ]
    assert len(failures) == 1
    assert isinstance(failures[0], ValueError)
    assert str(failures[0]) == "Invalid plugin id invalid/provider"
    assert len(harness.queries) == 1
    with harness.factory() as session:
        end_user = session.scalar(select(EndUser).where(EndUser.app_id == harness.target.id))
        assert end_user is not None
        assert end_user.type == EndUserType.SERVICE_API
        assert end_user.external_user_id == "alice"
        assert end_user.id == harness.end_user.id
    harness.assert_closed()


def test_existing_user_is_reused_within_the_token_app_only(harness: _Harness) -> None:
    decoy = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        end_user_type=EndUserType.SERVICE_API,
        session_id="alice",
        external_user_id="alice",
    )
    with harness.factory.begin() as session:
        session.add(decoy)
    assert harness.get().status_code == 200
    with harness.factory() as session:
        assert len(session.scalars(select(EndUser)).all()) == 2


@pytest.mark.parametrize("authorization", [None, "Basic test-token"])
def test_invalid_authorization_stops_before_database_admission(harness: _Harness, authorization: str | None) -> None:
    response = harness.get(authorization=authorization)
    assert response.status_code == 401
    assert response.json is not None
    assert response.json["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert harness.admissions == harness.provisions == harness.queries == []


@pytest.mark.parametrize("user", [None, ""])
def test_required_user_rejected_before_provisioning(harness: _Harness, user: str | None) -> None:
    response = harness.get(user=user)
    assert response.status_code == 400
    assert response.json is not None
    assert response.json["code"] == "invalid_param"
    assert response.json["message"] == "Arg user must be provided."
    assert harness.provisions == harness.queries == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "domain_error", "code", "message"),
    [
        ("missing_app", AppDefinitionUnavailableError, "app_not_found", "The app no longer exists."),
        ("null_app", AppDefinitionUnavailableError, "app_not_found", "The app no longer exists."),
        ("abnormal_app", AppAbnormalStatusError, "app_abnormal_status", "The app's status is abnormal."),
        ("empty_app_status", AppAbnormalStatusError, "app_abnormal_status", "The app's status is abnormal."),
        ("disabled_api", AppApiDisabledError, "app_api_disabled", "The app's API service has been disabled."),
        ("archived_tenant", WorkspaceArchivedError, "workspace_archived", "The workspace's status is archived."),
        ("missing_tenant", WorkspaceNotFoundError, "workspace_not_found", "Tenant does not exist."),
    ],
)
def test_app_and_workspace_admission(
    harness: _Harness,
    failure: Literal[
        "missing_app",
        "null_app",
        "abnormal_app",
        "empty_app_status",
        "disabled_api",
        "archived_tenant",
        "missing_tenant",
    ],
    domain_error: type[Exception],
    code: str,
    message: str,
) -> None:
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        tenant = session.get(Tenant, harness.tenant.id)
        assert target is not None
        assert tenant is not None
        match failure:
            case "missing_app":
                session.add(make_app(app_id=str(uuid4()), tenant_id=tenant.id))
                session.delete(target)
            case "null_app":
                token = session.scalar(select(ApiToken).where(ApiToken.token == "test-token"))
                assert token is not None
                token.app_id = None
            case "abnormal_app" | "empty_app_status":
                # Bypass EnumText validation to exercise malformed persisted status values.
                session.execute(
                    text("UPDATE apps SET status = :status WHERE id = :app_id"),
                    {"status": "disabled" if failure == "abnormal_app" else "", "app_id": target.id},
                )
            case "disabled_api":
                target.enable_api = False
            case "archived_tenant":
                tenant.status = TenantStatus.ARCHIVE
            case "missing_tenant":
                session.delete(tenant)
    services = harness.app.extensions["application_services"]
    assert isinstance(services, _Services)
    with pytest.raises(domain_error):
        services.app_definitions.get_service_api_app(None if failure == "null_app" else harness.target.id)
    harness.assert_closed()

    response = harness.get(user="new-user")
    assert response.status_code == 403
    assert response.json == {"code": code, "message": message, "status": 403}
    assert harness.provisions == harness.queries == []
    with harness.factory() as session:
        assert session.scalars(select(EndUser.id)).all() == [harness.end_user.id]
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_unsupported_mode_does_not_invoke_questions(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        target.mode = mode
    response = harness.get()
    assert response.status_code == 400
    assert response.json is not None
    assert response.json["code"] == "not_chat_app"
    assert harness.queries == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "status", "code", "message"),
    [
        ("message", 404, "not_found", "Message Not Exists."),
        ("conversation", 404, "not_found", "Conversation not found"),
        ("agent_version", 404, "agent_version_not_found_error", "Agent config version not found."),
        ("disabled", 403, "app_suggested_questions_after_answer_disabled", ""),
    ],
)
def test_domain_errors_have_specific_http_codes(
    harness: _Harness,
    failure: Literal["message", "conversation", "agent_version", "disabled"],
    status: int,
    code: str,
    message: str,
) -> None:
    with harness.factory.begin() as session:
        match failure:
            case "message":
                message_record = session.get(Message, harness.message_id)
                assert message_record is not None
                session.delete(message_record)
            case "conversation":
                conversation = session.get(Conversation, harness.conversation.id)
                assert conversation is not None
                session.delete(conversation)
            case "disabled":
                config = session.get(AppModelConfig, harness.config.id)
                assert config is not None
                config.suggested_questions_after_answer = '{"enabled":false}'
            case "agent_version":
                target = session.get(App, harness.target.id)
                assert target is not None
                target.mode = AppMode.AGENT
                session.add(
                    Agent(
                        tenant_id=harness.tenant.id,
                        app_id=target.id,
                        name="Missing published version",
                        scope=AgentScope.ROSTER,
                        source=AgentSource.AGENT_APP,
                        active_config_snapshot_id=str(uuid4()),
                    )
                )
    response = harness.get()
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    assert response.json is not None
    assert response.json["code"] == code
    assert response.json["status"] == status
    if message:
        assert response.json["message"] == message
    harness.assert_closed()


@pytest.mark.parametrize(
    ("change", "status", "code", "message"),
    [
        ("app_mode", 400, "app_unavailable", ""),
        ("end_user_tenant", 404, "not_found", "End user not found"),
    ],
)
def test_scope_changes_after_admission_have_specific_http_codes(
    harness: _Harness,
    change: Literal["app_mode", "end_user_tenant"],
    status: int,
    code: str,
    message: str,
) -> None:
    def change_scope(_session: Session, _transaction: SessionTransaction) -> None:
        with harness.factory.begin() as session:
            if change == "app_mode":
                target = session.get(App, harness.target.id)
                assert target is not None
                target.mode = AppMode.ADVANCED_CHAT
            else:
                end_user = session.get(EndUser, harness.end_user.id)
                assert end_user is not None
                end_user.tenant_id = str(uuid4())

    event.listen(harness.provision_factory, "after_transaction_end", change_scope, once=True)
    try:
        response = harness.get()
    finally:
        event.remove(harness.provision_factory, "after_transaction_end", change_scope)
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    assert response.json is not None
    assert response.json["code"] == code
    assert response.json["status"] == status
    if message:
        assert response.json["message"] == message
    harness.assert_closed()


def test_malformed_configuration_returns_an_opaque_internal_error(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        config = session.get(AppModelConfig, harness.config.id)
        assert config is not None
        config.suggested_questions_after_answer = "private diagnostic: invalid JSON"
    response = harness.get()
    assert response.status_code == 500
    assert response.headers["Content-Type"] == "application/json"
    assert response.json is not None
    assert response.json["code"] == "internal_server_error"
    assert response.json["status"] == 500
    assert "private diagnostic" not in response.get_data(as_text=True)
    harness.assert_closed()


def test_caller_session_and_pending_edits_are_preserved(harness: _Harness) -> None:
    with harness.app.app_context():
        caller = db.session()
        target = caller.get(App, harness.target.id)
        assert target is not None
        target.name = "Pending caller change"
        transaction = caller.get_transaction()
        response = harness.get()
        assert response.status_code == 200
        assert response.json == {"result": "success", "data": []}
        assert db.session() is caller
        assert caller.get_transaction() is transaction
        assert target in caller.dirty
        assert target.name == "Pending caller change"
        harness.assert_closed(caller=caller)
        caller.rollback()
    with harness.factory() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        assert target.name == harness.target.name


def test_default_admission_keeps_legacy_app_attached(harness: _Harness) -> None:
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True))
    def view(*, app_model: App, end_user: EndUser) -> str:
        assert object_session(app_model) is db.session()
        assert app_model.id == harness.target.id
        assert end_user.app_id == app_model.id
        return "legacy"

    harness.app.add_url_rule("/legacy", view_func=view)
    with harness.app.test_request_context("/legacy?user=alice", headers={"Authorization": "Bearer test-token"}):
        assert harness.app.dispatch_request() == "legacy"
        assert db.session().in_transaction()
        assert harness.admissions == []


def test_request_identity_remains_installed_after_generation(harness: _Harness) -> None:
    with harness.app.test_client() as client:
        response = client.get(
            f"/messages/{harness.message_id}/suggested?user=alice", headers={"Authorization": "Bearer test-token"}
        )
        assert response.status_code == 200
        assert response.json == {"result": "success", "data": []}
        assert current_user.id == harness.end_user.id
        assert current_user.app_id == harness.target.id
        assert current_user.tenant_id == harness.tenant.id


@pytest.mark.parametrize("fetch_from", [WhereisUserArg.QUERY, WhereisUserArg.JSON, WhereisUserArg.FORM])
def test_admission_injects_immutable_scope_and_provisions_request_user(
    harness: _Harness,
    fetch_from: WhereisUserArg,
) -> None:
    class AdmittedView:
        @service_api_end_user_admission(fetch_user_arg=FetchUserArg(fetch_from=fetch_from, required=True))
        def get(self, context: ServiceApiEndUserContext) -> dict[str, str]:
            assert isinstance(context, ServiceApiEndUserContext)
            harness.assert_closed()
            assert current_user.id == context.end_user_id
            payload = asdict(context)
            for field_name in payload:
                with pytest.raises(FrozenInstanceError):
                    setattr(context, field_name, "untrusted")
            return payload

    harness.app.add_url_rule("/admitted", view_func=AdmittedView().get, methods=["GET", "POST"])
    client = harness.app.test_client()
    headers = {"Authorization": "Bearer test-token"}
    match fetch_from:
        case WhereisUserArg.QUERY:
            response = client.get("/admitted?user=bob", headers=headers)
        case WhereisUserArg.JSON:
            response = client.post("/admitted", json={"user": "bob"}, headers=headers)
        case WhereisUserArg.FORM:
            response = client.post("/admitted", data={"user": "bob"}, headers=headers)
    assert response.status_code == 200
    with harness.factory() as session:
        end_user = session.scalar(
            select(EndUser).where(EndUser.app_id == harness.target.id, EndUser.external_user_id == "bob")
        )
        assert end_user is not None
        assert end_user.session_id == "bob"
        assert response.json == {
            "app_id": harness.target.id,
            "tenant_id": harness.tenant.id,
            "app_mode": harness.target.mode,
            "end_user_id": end_user.id,
        }
