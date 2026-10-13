"""Rename HTTP contracts with real token admission, services, and SQLite transactions."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from flask import Flask
from flask_login import LoginManager
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.service_api.app.conversation import ConversationRenameApi
from extensions.application_services.resource_access_token import build_resource_access_token_service
from extensions.ext_database import db
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from models import Tenant, TenantStatus
from models.enums import ConversationFromSource, EndUserType
from models.model import ApiToken, App, AppMode, Conversation, EndUser
from models.provider import Provider
from models.resource_access_token import ResourceAccessToken
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from repositories.conversation_repository import ConversationRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.auth.resource_access_token_contracts import ResourceAccessTokenResource
from services.conversation_name_generator import generate_conversation_name
from services.conversation_name_service import ConversationNameService
from services.resource_access_token_service import ResourceAccessTokenService
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message

_CREATED_AT = datetime(2026, 1, 2, 3, 4, 5)
_UPDATED_AT = datetime(2026, 1, 3, 3, 4, 5)
_INPUTS: dict[str, JsonValue] = {"text": "", "list": [], "zero": 0, "flag": False, "null": None}


@dataclass(frozen=True)
class _EndUsers:
    commands: AppScopedEndUserService[EndUser]


@dataclass(frozen=True)
class _Services:
    app_definitions: AppDefinitionQueryService
    app_scoped_end_users: _EndUsers
    conversation_names: ConversationNameService
    resource_access_tokens: ResourceAccessTokenService


@dataclass(frozen=True)
class _Harness:
    app: Flask
    api: ExternalApi
    repository_factory: sessionmaker[Session]
    target: App
    tenant: Tenant
    end_user: EndUser
    conversation: Conversation
    factory: sessionmaker[Session]
    provision_factory: sessionmaker[Session]
    admissions: list[Session]
    provisions: list[Session]
    queries: list[Session]
    scoped_sessions: list[Session]

    def post(
        self,
        *,
        body: dict[str, object],
        user: str | None = "alice",
        authorization: str | None = "Bearer rename-token",
        requested_app_id: str | None = None,
        conversation_id: str | None = None,
    ) -> TestResponse:
        headers: dict[str, str] = {"Authorization": authorization} if authorization is not None else {}
        if requested_app_id is not None:
            headers["X-Dify-App-ID"] = requested_app_id
        payload = dict(body)
        if user is not None:
            payload["user"] = user
        return self.app.test_client().post(
            f"/conversations/{conversation_id or self.conversation.id}/name", json=payload, headers=headers
        )

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.admissions + self.provisions + self.queries + self.scoped_sessions
        )

    def assert_name(self, name: str) -> None:
        with self.factory() as session:
            conversation = session.get(Conversation, self.conversation.id)
            assert conversation is not None
            assert conversation.name == name


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    tenant = Tenant(name="Rename workspace")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    end_user = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=target.id,
        end_user_type=EndUserType.SERVICE_API,
        session_id="alice",
        external_user_id="alice",
    )
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        name="Original name",
        inputs=dict(_INPUTS),
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    conversation.created_at = _CREATED_AT
    conversation.updated_at = _UPDATED_AT
    conversation.introduction = None
    token = ApiToken(app_id=target.id, tenant_id=tenant.id, type="app", token="rename-token")
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, target, end_user, conversation, token])

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    LoginManager(app)
    admissions: list[Session] = []
    provisions: list[Session] = []
    queries: list[Session] = []
    scoped_sessions: list[Session] = []
    admission_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    provision_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    query_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    def track_admission(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        admissions.append(session)

    def track_provision(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert all(not admission.in_transaction() and not admission.identity_map for admission in admissions)
        provisions.append(session)

    def track_query(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        # This catches the legacy admission retaining a second connection while
        # the rename repository opens its own transaction, before request teardown.
        assert not db.session().in_transaction()
        assert all(
            not previous.in_transaction() and not previous.identity_map
            for previous in admissions + provisions + queries + scoped_sessions
        )
        queries.append(session)

    def track_scoped(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        scoped_sessions.append(session)

    event.listen(admission_factory, "after_begin", track_admission)
    event.listen(provision_factory, "after_begin", track_provision)
    event.listen(query_factory, "after_begin", track_query)
    event.listen(db.session.session_factory, "after_begin", track_scoped)
    app.extensions["application_services"] = _Services(
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=admission_factory), builtin_icon_url_prefix=""
        ),
        app_scoped_end_users=_EndUsers(
            AppScopedEndUserService(end_users=AppScopedEndUserRepo(session_factory=provision_factory))
        ),
        conversation_names=ConversationNameService(
            conversations=ConversationRepository(session_factory=query_factory),
            generate_name=generate_conversation_name,
        ),
        resource_access_tokens=build_resource_access_token_service(database_client=admission_factory),
    )
    api = ExternalApi(app)
    api.add_resource(ConversationRenameApi, "/conversations/<uuid:conversation_id>/name")
    yield _Harness(
        app,
        api,
        query_factory,
        target,
        tenant,
        end_user,
        conversation,
        sqlite_session_factory,
        provision_factory,
        admissions,
        provisions,
        queries,
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
def test_manual_rename_persists_wire_contract_after_admission_connections_close(
    harness: _Harness, mode: AppMode
) -> None:
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        target.mode = mode

    response = harness.post(body={"name": "Renamed title"})

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/json"
    assert response.json is not None
    assert response.json == {
        "id": harness.conversation.id,
        "name": "Renamed title",
        "inputs": _INPUTS,
        "status": harness.conversation.status,
        "introduction": None,
        "created_at": int(_CREATED_AT.timestamp()),
        "updated_at": response.json["updated_at"],
    }
    assert isinstance(response.json["updated_at"], int)
    assert response.json["updated_at"] > int(_UPDATED_AT.timestamp())
    assert harness.admissions
    assert harness.provisions
    assert harness.queries
    assert harness.scoped_sessions == []
    harness.assert_closed()
    with harness.factory() as session:
        conversation = session.get(Conversation, harness.conversation.id)
        assert conversation is not None
        assert conversation.name == "Renamed title"
        assert conversation.updated_at is not None
        assert response.json["updated_at"] == int(conversation.updated_at.timestamp())


@pytest.mark.parametrize("body", [{}, {"name": None}, {"name": ""}, {"name": "   "}])
def test_invalid_manual_name_returns_422_without_renaming(harness: _Harness, body: dict[str, object]) -> None:
    response = harness.post(body=body)
    assert response.status_code == 422
    assert response.json is not None
    assert response.json["code"] == "unprocessable_entity"
    assert harness.queries == []
    harness.assert_name("Original name")
    harness.assert_closed()


@pytest.mark.parametrize("body", [{"auto_generate": True}, {"name": "Ignored manual name", "auto_generate": True}])
def test_auto_name_ignores_manual_name_and_preserves_current_name_on_provider_failure(
    harness: _Harness, body: dict[str, object], caplog: pytest.LogCaptureFixture
) -> None:
    with harness.factory.begin() as session:
        session.add_all(
            [
                make_message(
                    message_id=str(uuid4()),
                    app_id=harness.target.id,
                    conversation_id=harness.conversation.id,
                    query="Explain this topic",
                    inputs={},
                    message={},
                    answer="Explained.",
                    currency="USD",
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    from_source=ConversationFromSource.API,
                    from_end_user_id=harness.end_user.id,
                ),
                # Real provider validation fails before plugin discovery/network I/O.
                Provider(tenant_id=harness.tenant.id, provider_name="invalid/provider", is_valid=True),
            ]
        )

    response = harness.post(body=body)

    assert response.status_code == 200
    assert response.json is not None
    assert response.json["name"] == "Original name"
    assert response.json["updated_at"] == int(_UPDATED_AT.timestamp())
    failures = [
        record.exc_info[1]
        for record in caplog.records
        if record.name == "services.conversation_name_service" and record.exc_info is not None
    ]
    assert len(failures) == 1
    assert isinstance(failures[0], ValueError)
    assert str(failures[0]) == "Invalid plugin id invalid/provider"
    harness.assert_name("Original name")
    harness.assert_closed()


def test_auto_name_without_messages_returns_explicit_404(harness: _Harness) -> None:
    response = harness.post(body={"auto_generate": True})
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "conversation_first_message_not_found"
    assert response.json["message"] == "The conversation has no message from which to generate a name."
    harness.assert_name("Original name")
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_mode_is_rejected_without_renaming(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        target.mode = mode
    response = harness.post(body={"name": "Rejected"})
    assert response.status_code == 400
    assert response.json is not None
    assert response.json["code"] == "not_chat_app"
    assert harness.queries == []
    harness.assert_name("Original name")
    harness.assert_closed()


@pytest.mark.parametrize("failure", ["different_user", "different_app", "different_workspace", "console", "deleted"])
def test_conversation_ownership_is_enforced_before_rename(harness: _Harness, failure: str) -> None:
    with harness.factory.begin() as session:
        conversation = session.get(Conversation, harness.conversation.id)
        assert conversation is not None
        if failure == "different_user":
            other = make_end_user(
                end_user_id=str(uuid4()),
                tenant_id=harness.tenant.id,
                app_id=harness.target.id,
                end_user_type=EndUserType.SERVICE_API,
                session_id="bob",
                external_user_id="bob",
            )
            session.add(other)
            conversation.from_end_user_id = other.id
        elif failure in {"different_app", "different_workspace"}:
            tenant_id = harness.tenant.id if failure == "different_app" else str(uuid4())
            other_app = make_app(app_id=str(uuid4()), tenant_id=tenant_id)
            session.add(other_app)
            conversation.app_id = other_app.id
        elif failure == "console":
            conversation.from_source = ConversationFromSource.CONSOLE
            conversation.from_account_id = str(uuid4())
        else:
            conversation.is_deleted = True

    response = harness.post(body={"name": "Rejected"})

    assert response.status_code == 404
    assert response.json == {
        "code": "conversation_not_found",
        "message": "The conversation was not found for this user and app.",
        "status": 404,
    }
    harness.assert_name("Original name")
    harness.assert_closed()


@pytest.mark.parametrize("change_app_too", [False, True], ids=["end-user-workspace", "app-workspace"])
def test_workspace_change_after_admission_prevents_rename(harness: _Harness, change_app_too: bool) -> None:
    def change_owner(_session: Session, _transaction: SessionTransaction) -> None:
        with harness.factory.begin() as session:
            end_user = session.get(EndUser, harness.end_user.id)
            assert end_user is not None
            end_user.tenant_id = str(uuid4())
            if change_app_too:
                target = session.get(App, harness.target.id)
                assert target is not None
                target.tenant_id = end_user.tenant_id

    event.listen(harness.provision_factory, "after_transaction_end", change_owner, once=True)
    try:
        response = harness.post(body={"name": "Rejected"})
    finally:
        event.remove(harness.provision_factory, "after_transaction_end", change_owner)
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "conversation_not_found"
    harness.assert_name("Original name")
    harness.assert_closed()


def test_unknown_conversation_cannot_rename_an_existing_decoy(harness: _Harness) -> None:
    response = harness.post(body={"name": "Rejected"}, conversation_id=str(uuid4()))
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "conversation_not_found"
    harness.assert_name("Original name")
    harness.assert_closed()


@pytest.mark.parametrize("authorization", [None, "Basic rename-token", "Bearer invalid-token"])
def test_invalid_token_returns_401_before_rename(harness: _Harness, authorization: str | None) -> None:
    response = harness.post(body={"name": "Rejected"}, authorization=authorization)
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert response.json is not None
    assert response.json["code"] == "unauthorized"
    assert harness.admissions == harness.provisions == harness.queries == []
    harness.assert_name("Original name")
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "code"), [("disabled_api", "app_api_disabled"), ("archived_workspace", "workspace_archived")]
)
def test_disabled_app_or_workspace_stops_before_provisioning(harness: _Harness, failure: str, code: str) -> None:
    with harness.factory.begin() as session:
        if failure == "disabled_api":
            target = session.get(App, harness.target.id)
            assert target is not None
            target.enable_api = False
        else:
            tenant = session.get(Tenant, harness.tenant.id)
            assert tenant is not None
            tenant.status = TenantStatus.ARCHIVE
    response = harness.post(body={"name": "Rejected"}, user="new-user")
    assert response.status_code == 403
    assert response.json is not None
    assert response.json["code"] == code
    assert harness.provisions == harness.queries == []
    with harness.factory() as session:
        assert session.scalars(select(EndUser.id)).all() == [harness.end_user.id]
    harness.assert_name("Original name")
    harness.assert_closed()


@pytest.mark.parametrize("multiple_apps", [False, True], ids=["implicit-single-app", "explicit-multiple-apps"])
def test_resource_token_renames_bound_app_and_records_usage(harness: _Harness, multiple_apps: bool) -> None:
    app_ids = (harness.target.id,)
    if multiple_apps:
        other = make_app(app_id=str(uuid4()), tenant_id=harness.tenant.id)
        with harness.factory.begin() as session:
            session.add(other)
        app_ids = (other.id, harness.target.id)
    services = harness.app.extensions["application_services"]
    assert isinstance(services, _Services)
    token = services.resource_access_tokens.create(
        RequestContext(
            request_id="rename-resource-token",
            trace_id=None,
            account_id=str(uuid4()),
            active_workspace_id=harness.tenant.id,
        ),
        name="Rename app token",
        resources=tuple(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app_id) for app_id in app_ids),
    )

    response = harness.post(
        body={"name": "Resource token rename"},
        authorization=f"Bearer {token.token}",
        requested_app_id=harness.target.id if multiple_apps else None,
    )

    assert response.status_code == 200
    assert response.json is not None
    assert response.json["name"] == "Resource token rename"
    harness.assert_name("Resource token rename")
    harness.assert_closed()
    with harness.factory() as session:
        stored_token = session.get(ResourceAccessToken, token.token_id)
        assert stored_token is not None
        assert stored_token.last_used_at is not None
        assert session.scalars(select(EndUser.id)).all() == [harness.end_user.id]
