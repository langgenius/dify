"""Service API suggested questions with real admission, end-user provisioning, and SQLite."""

from collections.abc import Iterator, Sequence
from dataclasses import FrozenInstanceError, asdict, dataclass, field, replace
from decimal import Decimal
from typing import Literal
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from flask_login import LoginManager, current_user
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, SessionTransaction, object_session, sessionmaker
from werkzeug.test import TestResponse

import services.message_suggested_questions_generator as generator_module
from controllers.service_api import wraps as api_wraps
from controllers.service_api.app.message import MessageSuggestedApi
from controllers.service_api.flask_admission import service_api_end_user_admission
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.errors.error import ProviderTokenNotInitError
from core.model_manager import ModelInstance, ModelManager
from extensions.ext_database import db
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.errors.invoke import InvokeError
from libs.external_api import ExternalApi
from machinery.context import ServiceApiEndUserContext
from models import Tenant, TenantStatus
from models.enums import ConversationFromSource, EndUserType
from models.model import App, AppMode, AppModelConfig, EndUser
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from repositories.message_suggested_questions_repository import SuggestedQuestionsRepository
from services.agent.errors import AgentVersionNotFoundError
from services.api_token_service import CachedApiToken
from services.app_definition_query_service import AppDefinitionQueryService, AppDefinitionUnavailableError
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_queries import SuggestedQuestionsQuery
from services.message_suggested_questions_service import (
    MessageSuggestedQuestions,
    MessageSuggestedQuestionsService,
    SuggestedQuestionsActor,
    SuggestedQuestionsActorNotFoundError,
    SuggestedQuestionsEndUser,
)
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass
class _Questions:
    sessions: list[Session]
    questions: list[str] = field(default_factory=lambda: ["What next?"])
    error: Exception | None = None
    calls: list[tuple[str, str, str, SuggestedQuestionsActor, str]] = field(default_factory=list)

    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: SuggestedQuestionsActor,
        message_id: str,
    ) -> list[str]:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        assert isinstance(actor, SuggestedQuestionsEndUser)
        assert current_user.id == actor.end_user_id
        assert current_user.app_id == app_id
        assert current_user.tenant_id == app_owner_tenant_id
        self.calls.append((app_id, app_owner_tenant_id, expected_app_mode, actor, message_id))
        if self.error is not None:
            raise self.error
        return self.questions


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
    questions: _Questions
    factory: sessionmaker[Session]
    message_id: str
    admissions: list[Session]
    provisions: list[Session]

    def get(self, *, user: str | None = "alice", authorization: str | None = "Bearer test-token") -> TestResponse:
        headers: dict[str, str] = {"Authorization": authorization} if authorization is not None else {}
        query: dict[str, str] = {"user": user} if user is not None else {}
        return self.app.test_client().get(f"/messages/{self.message_id}/suggested", query_string=query, headers=headers)

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map for session in self.admissions + self.provisions
        )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    tenant = Tenant(name="API workspace")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, target])

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    LoginManager(app)
    admissions: list[Session] = []
    provisions: list[Session] = []
    sessions: list[Session] = []
    admission_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    provision_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    def track_admission(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        admissions.append(session)
        sessions.append(session)

    def track_provision(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        # End-user lookup/creation must not overlap the admission transaction.
        assert all(not admission.in_transaction() and not admission.identity_map for admission in admissions)
        provisions.append(session)
        sessions.append(session)

    event.listen(admission_factory, "after_begin", track_admission)
    event.listen(provision_factory, "after_begin", track_provision)

    token = CachedApiToken(
        id=str(uuid4()),
        app_id=target.id,
        tenant_id=tenant.id,
        type="app",
        token="test-token",
        last_used_at=None,
        created_at=None,
    )

    def cached_token(auth_token: str, scope: str | None = None) -> CachedApiToken:
        assert auth_token == "test-token"
        assert scope == "app"
        return token

    monkeypatch.setattr(api_wraps.ApiTokenCache, "get", cached_token)
    monkeypatch.setattr(api_wraps, "record_token_usage", lambda _token, _scope: None)
    questions = _Questions(sessions)
    app.extensions["application_services"] = _Services(
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=admission_factory), builtin_icon_url_prefix=""
        ),
        message_suggested_questions=questions,
        app_scoped_end_users=_EndUsers(
            AppScopedEndUserService(end_users=AppScopedEndUserRepo(session_factory=provision_factory))
        ),
    )
    api = ExternalApi(app)
    api.add_resource(MessageSuggestedApi, "/messages/<uuid:message_id>/suggested")
    yield _Harness(app, target, tenant, questions, sqlite_session_factory, str(uuid4()), admissions, provisions)
    event.remove(admission_factory, "after_begin", track_admission)
    event.remove(provision_factory, "after_begin", track_provision)
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_admitted_identity_and_mode_are_forwarded(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        target.mode = mode
    response = harness.get()
    assert response.status_code == 200
    assert response.json == {"result": "success", "data": ["What next?"]}
    assert response.headers["Content-Type"] == "application/json"
    with harness.factory() as session:
        end_user = session.scalar(select(EndUser).where(EndUser.app_id == harness.target.id))
        assert end_user is not None
        assert end_user.type == EndUserType.SERVICE_API
        assert end_user.external_user_id == "alice"
        assert harness.questions.calls == [
            (
                harness.target.id,
                harness.tenant.id,
                mode,
                SuggestedQuestionsEndUser(end_user_id=end_user.id, invoke_from="service-api"),
                harness.message_id,
            )
        ]
    harness.assert_closed()


def test_existing_user_is_reused_within_the_token_app_only(harness: _Harness) -> None:
    existing = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=harness.tenant.id,
        app_id=harness.target.id,
        end_user_type=EndUserType.SERVICE_API,
        session_id="alice",
        external_user_id="alice",
    )
    decoy = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        end_user_type=EndUserType.SERVICE_API,
        session_id="alice",
        external_user_id="alice",
    )
    with harness.factory.begin() as session:
        session.add_all([existing, decoy])
    assert harness.get().status_code == 200
    assert harness.questions.calls[0][3] == SuggestedQuestionsEndUser(
        end_user_id=existing.id, invoke_from="service-api"
    )
    with harness.factory() as session:
        assert len(session.scalars(select(EndUser)).all()) == 2


@pytest.mark.parametrize("questions", [[], ["One?", "Two?"]])
def test_response_preserves_question_lists(harness: _Harness, questions: list[str]) -> None:
    harness.questions.questions = questions
    response = harness.get()
    assert response.status_code == 200
    assert response.json == {"result": "success", "data": questions}


@pytest.mark.parametrize("authorization", [None, "Basic test-token"])
def test_invalid_authorization_stops_before_database_admission(harness: _Harness, authorization: str | None) -> None:
    response = harness.get(authorization=authorization)
    assert response.status_code == 401
    assert response.json is not None
    assert response.json["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert harness.admissions == harness.provisions == harness.questions.calls == []


@pytest.mark.parametrize("user", [None, ""])
def test_required_user_rejected_before_provisioning(harness: _Harness, user: str | None) -> None:
    response = harness.get(user=user)
    assert response.status_code == 400
    assert response.json is not None
    assert response.json["code"] == "invalid_param"
    assert response.json["message"] == "Arg user must be provided."
    assert harness.provisions == harness.questions.calls == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "status", "message"),
    [
        ("missing_app", 403, "The app no longer exists."),
        ("disabled_api", 403, "The app's API service has been disabled."),
        ("archived_tenant", 403, "The workspace's status is archived."),
        ("missing_tenant", 400, "Tenant does not exist."),
    ],
)
def test_app_and_workspace_admission(
    harness: _Harness,
    failure: Literal["missing_app", "disabled_api", "archived_tenant", "missing_tenant"],
    status: int,
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
            case "disabled_api":
                target.enable_api = False
            case "archived_tenant":
                tenant.status = TenantStatus.ARCHIVE
            case "missing_tenant":
                session.delete(tenant)
    response = harness.get()
    assert response.status_code == status
    assert response.json is not None
    assert response.json["message"] == message
    assert harness.provisions == harness.questions.calls == []
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
    assert harness.questions.calls == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("error", "status", "code", "message"),
    [
        (AppDefinitionUnavailableError(), 400, "app_unavailable", ""),
        (SuggestedQuestionsActorNotFoundError(), 404, "not_found", "End user not found"),
        (MessageNotExistsError(), 404, "not_found", "Message Not Exists."),
        (ConversationNotExistsError(), 404, "not_found", "Conversation not found"),
        (AgentVersionNotFoundError(), 404, "agent_version_not_found_error", "Agent config version not found."),
        (SuggestedQuestionsAfterAnswerDisabledError(), 403, "app_suggested_questions_after_answer_disabled", ""),
        (RuntimeError("private diagnostic"), 500, "internal_server_error", ""),
    ],
)
def test_domain_errors_have_specific_http_codes(
    harness: _Harness,
    error: Exception,
    status: int,
    code: str,
    message: str,
) -> None:
    harness.questions.error = error
    response = harness.get()
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    assert response.json is not None
    assert response.json["code"] == code
    assert response.json["status"] == status
    if message:
        assert response.json["message"] == message
    assert "private diagnostic" not in response.get_data(as_text=True)
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "expected_status", "expected_stages"),
    [
        ("history_model", 200, ["history_model"]),
        ("generation_model", 200, ["history_model", "tokens", "generation_model", "trace"]),
        ("invoke", 200, ["history_model", "tokens", "generation_model", "schema", "invoke", "trace"]),
        ("tokens", 400, ["history_model", "tokens"]),
    ],
)
def test_real_generation_preserves_stage_specific_failure_responses(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    failure: Literal["history_model", "generation_model", "invoke", "tokens"],
    expected_status: int,
    expected_stages: list[str],
) -> None:
    end_user = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=harness.tenant.id,
        app_id=harness.target.id,
        end_user_type=EndUserType.SERVICE_API,
        session_id="alice",
        external_user_id="alice",
    )
    config = AppModelConfig(app_id=harness.target.id, suggested_questions_after_answer='{"enabled": true}')
    config.id = str(uuid4())
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=harness.target.id,
        inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    conversation.app_model_config_id = config.id
    message = make_message(
        message_id=harness.message_id,
        app_id=harness.target.id,
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
    with harness.factory.begin() as session:
        session.add_all([end_user, config, conversation, message])

    query_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    query_sessions: list[Session] = []
    model_sessions: list[Session] = []
    closed_at_stage: list[tuple[str, bool]] = []

    @event.listens_for(query_factory, "after_begin")
    def track_query(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        query_sessions.append(session)

    def record_sessions(stage: str) -> None:
        sessions = harness.admissions + harness.provisions + query_sessions + model_sessions
        closed_at_stage.append(
            (stage, all(not session.in_transaction() and not session.identity_map for session in sessions))
        )

    model = Mock(spec=ModelInstance)

    def resolve_model(**_kwargs: object) -> Mock:
        stage = "generation_model" if model_sessions else "history_model"
        record_sessions(stage)
        # Real model resolution can leave a scoped read transaction behind.
        session = db.session()
        session.get(App, harness.target.id)
        model_sessions.append(session)
        if failure == stage:
            raise ProviderTokenNotInitError("Credential unavailable")
        return model

    def count_tokens(prompt_messages: Sequence[PromptMessage]) -> int:
        record_sessions("tokens")
        if failure == "tokens":
            raise InvokeError("Token counting failed")
        return len(prompt_messages)

    def model_schema() -> AIModelEntity:
        record_sessions("schema")
        return AIModelEntity.model_construct(parameter_rules=[])

    def invoke(**_kwargs: object) -> None:
        record_sessions("invoke")
        raise InvokeError("Provider timed out")

    model.get_llm_num_tokens.side_effect = count_tokens
    model.get_model_schema.side_effect = model_schema
    model.invoke_llm.side_effect = invoke
    manager = Mock(spec=ModelManager)
    manager.get_default_model_instance.side_effect = resolve_model
    for_tenant = Mock(return_value=manager)
    monkeypatch.setattr(generator_module.ModelManager, "for_tenant", for_tenant)
    trace = Mock(spec=generator_module.TraceQueueManager)
    trace.add_trace_task.side_effect = lambda _task: record_sessions("trace")
    monkeypatch.setattr(generator_module, "TraceQueueManager", Mock(return_value=trace))

    queries = SuggestedQuestionsQuery(session_factory=query_factory, repository_factory=SuggestedQuestionsRepository)
    services: _Services = harness.app.extensions["application_services"]
    harness.app.extensions["application_services"] = replace(
        services,
        message_suggested_questions=MessageSuggestedQuestionsService(
            queries=queries, generator=SuggestedQuestionsGenerator()
        ),
    )
    response = harness.get()

    assert response.status_code == expected_status
    if expected_status == 200:
        assert response.json == {"result": "success", "data": []}
    else:
        assert response.json == {
            "code": "completion_request_error",
            "message": "Token counting failed",
            "status": 400,
        }
    assert response.headers["Content-Type"] == "application/json"
    assert closed_at_stage == [(stage, True) for stage in expected_stages]
    assert len(query_sessions) == (1 if failure == "history_model" else 2)
    assert for_tenant.call_count == len(model_sessions)
    for call in for_tenant.call_args_list:
        assert call.kwargs == {"tenant_id": harness.tenant.id}
    for call in manager.get_default_model_instance.call_args_list:
        assert call.kwargs == {"tenant_id": harness.tenant.id, "model_type": ModelType.LLM}
    assert all(not session.in_transaction() and not session.identity_map for session in query_sessions + model_sessions)
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
        assert db.session() is caller
        assert caller.get_transaction() is transaction
        assert target in caller.dirty
        assert target.name == "Pending caller change"
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
        actor = harness.questions.calls[0][3]
        assert isinstance(actor, SuggestedQuestionsEndUser)
        assert current_user.id == actor.end_user_id
        assert current_user.app_id == harness.target.id


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
            response = client.get("/admitted?user=alice", headers=headers)
        case WhereisUserArg.JSON:
            response = client.post("/admitted", json={"user": "alice"}, headers=headers)
        case WhereisUserArg.FORM:
            response = client.post("/admitted", data={"user": "alice"}, headers=headers)
    assert response.status_code == 200
    with harness.factory() as session:
        end_user = session.scalar(select(EndUser).where(EndUser.app_id == harness.target.id))
        assert end_user is not None
        assert end_user.session_id == "alice"
        assert response.json == {
            "app_id": harness.target.id,
            "tenant_id": harness.tenant.id,
            "app_mode": harness.target.mode,
            "end_user_id": end_user.id,
        }
