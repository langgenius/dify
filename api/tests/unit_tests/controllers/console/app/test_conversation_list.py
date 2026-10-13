"""Console conversation lists through real account admission, services and SQLite."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACCheck, RBACPermission
from controllers.console.app.conversation import ChatConversationApi, CompletionConversationApi
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from fields.conversation_fields import (
    ConversationPagination,
    ConversationResponseSource,
    ConversationWithSummaryPagination,
)
from libs.external_api import ExternalApi
from libs.helper import dump_response
from libs.token import generate_csrf_token
from models import Account, Tenant, TenantAccountJoin
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, Conversation, Message, MessageAnnotation, MessageFeedback
from models.utils.file_input_compat import restore_input_files
from repositories.conversation_repository import ConversationRepository
from services.conversation_query_service import ConversationQueryService
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message

type _Kind = Literal["chat", "completion"]
_CREATED_AT = datetime(2024, 1, 15, 6, 30, 0)


@dataclass(frozen=True)
class _Services:
    conversation_queries: ConversationQueryService


@dataclass
class _Harness:
    app: Flask
    factory: sessionmaker[Session]
    account: Account
    tenant: Tenant
    target: App
    sessions: list[Session] = field(default_factory=list)
    after_account_load: Callable[[], None] | None = None

    def get(
        self,
        kind: _Kind,
        *,
        query: dict[str, str | int] | None = None,
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
        response = client.get(
            f"/apps/{app_id or self.target.id}/{kind}-conversations", query_string=query, headers=headers
        )
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        assert response.content_type == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        return response

    def mode(self, mode: AppMode) -> None:
        with self.factory.begin() as session:
            target = session.get(App, self.target.id)
            assert target is not None
            target.mode = mode
        self.target.mode = mode


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
    account = make_account(account_id=str(uuid4()), timezone="Asia/Shanghai")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                target,
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

    @login_manager.user_loader
    def load_account(account_id: str) -> Account | None:
        with sqlite_session_factory() as session:
            loaded = session.get(Account, account_id)
            if loaded is not None:
                loaded.set_tenant_id_with_session(tenant.id, session=session)
        if state.after_account_load is not None:
            state.after_account_load()
        return loaded

    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    state = _Harness(app, sqlite_session_factory, account, tenant, target)

    @event.listens_for(factory, "after_begin")
    def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert all(not previous.in_transaction() and not previous.identity_map for previous in state.sessions)
        state.sessions.append(session)

    app.extensions["application_services"] = _Services(
        ConversationQueryService(
            conversations=ConversationRepository(session_factory=factory), restore_inputs=restore_input_files
        )
    )
    api = ExternalApi(app)
    api.add_resource(ChatConversationApi, "/apps/<uuid:app_id>/chat-conversations")
    api.add_resource(CompletionConversationApi, "/apps/<uuid:app_id>/completion-conversations")
    yield state
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def _conversation(
    harness: _Harness,
    *,
    app_id: str | None = None,
    name: str = "Conversation name",
    query: str = "First question",
    answer: str = "First answer",
    created_at: datetime = _CREATED_AT,
    updated_at: datetime = _CREATED_AT,
    deleted: bool = False,
    invoke_from: str = "web-app",
    with_message: bool = True,
) -> Conversation:
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=app_id or harness.target.id,
        mode=harness.target.mode,
        name=name,
        inputs={},
        status="normal",
        from_source=ConversationFromSource.API,
        from_account_id=harness.account.id,
        introduction="Conversation introduction",
        invoke_from=invoke_from,
        is_deleted=deleted,
        override_model_configs='{"pre_prompt":"Be useful","model":{"name":"example"}}',
    )
    conversation.created_at = created_at
    conversation.updated_at = updated_at
    message = make_message(
        message_id=str(uuid4()),
        app_id=conversation.app_id,
        conversation_id=conversation.id,
        inputs={"text": "", "zero": 0, "boolean": False, "empty": [], "null": None},
        query=query,
        answer=answer,
        message=[{"text": "Prompt", "role": "user"}],
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        total_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        created_at=created_at,
        updated_at=updated_at,
    )
    with harness.factory.begin() as session:
        session.add(conversation)
        if with_message:
            session.add(message)
    return conversation


def _ids(response: TestResponse) -> list[str]:
    assert response.status_code == 200, response.get_json()
    return [row["id"] for row in response.get_json()["data"]]


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_empty_page_retains_wire_contract(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    response = harness.get(kind)
    assert response.status_code == 200
    assert response.get_json() == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_response_matches_legacy_projection_without_marking_read(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    conversation = _conversation(harness)
    with harness.factory.begin() as session:
        message = session.scalar(select(Message).where(Message.conversation_id == conversation.id))
        assert message is not None
        session.add_all(
            [
                MessageAnnotation(
                    app_id=harness.target.id,
                    conversation_id=conversation.id,
                    message_id=message.id,
                    account_id=harness.account.id,
                    question="Question",
                    content="Annotation answer",
                ),
                MessageFeedback(
                    app_id=harness.target.id,
                    conversation_id=conversation.id,
                    message_id=message.id,
                    rating=FeedbackRating.LIKE,
                    from_source=FeedbackFromSource.USER,
                ),
            ]
        )
    schema = ConversationPagination if kind == "completion" else ConversationWithSummaryPagination
    with harness.app.app_context(), harness.factory() as session:
        stored = session.get(Conversation, conversation.id)
        assert stored is not None
        expected = dump_response(
            schema,
            {
                "page": 1,
                "per_page": 20,
                "total": 1,
                "has_next": False,
                "items": [ConversationResponseSource(stored, session=session)],
            },
        )
    response = harness.get(kind)
    assert response.status_code == 200
    assert response.get_json() == expected
    assert response.get_json()["data"][0]["model_config"] == {"model": {"name": "example"}, "pre_prompt": "Be useful"}
    with harness.factory() as session:
        stored = session.get(Conversation, conversation.id)
        assert stored is not None
        assert stored.read_at is None
        assert stored.read_account_id is None


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_pagination_and_app_deletion_isolation(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    first = _conversation(harness, created_at=_CREATED_AT, updated_at=_CREATED_AT)
    second = _conversation(
        harness, created_at=_CREATED_AT + timedelta(hours=1), updated_at=_CREATED_AT + timedelta(hours=1)
    )
    _conversation(harness, app_id=str(uuid4()))
    _conversation(harness, deleted=True)
    first_page = harness.get(kind, query={"limit": 1})
    assert _ids(first_page) == [second.id]
    assert first_page.get_json()["total"] == 2
    assert first_page.get_json()["has_more"] is True
    second_page = harness.get(kind, query={"limit": 1, "page": 2})
    assert _ids(second_page) == [first.id]
    assert second_page.get_json()["has_more"] is False
    assert _ids(harness.get(kind, query={"page": 3, "limit": 1})) == []


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize(
    "query", [{"limit": 0}, {"limit": 101}, {"page": 0}, {"page": 100000}, {"annotation_status": "bad"}]
)
def test_invalid_query_returns_422(harness: _Harness, kind: _Kind, query: dict[str, str | int]) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    response = harness.get(kind, query=query)
    assert response.status_code == 422


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize("query", [{"start": "bad"}, {"start": "2024-01-16 00:00", "end": "2024-01-15 00:00"}])
def test_invalid_date_range_is_precise_400(harness: _Harness, kind: _Kind, query: dict[str, str | int]) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    response = harness.get(kind, query=query)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"
    assert response.get_json()["message"]


@pytest.mark.parametrize(
    ("kind", "sort_by"), [("completion", "-created_at"), ("chat", "created_at"), ("chat", "-updated_at")]
)
def test_account_timezone_and_exact_end_second_are_inclusive(harness: _Harness, kind: _Kind, sort_by: str) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    boundary = _CREATED_AT.replace(second=59)
    expected = _conversation(harness, created_at=boundary, updated_at=boundary)
    _conversation(
        harness, created_at=boundary + timedelta(microseconds=1), updated_at=boundary + timedelta(microseconds=1)
    )
    _conversation(harness, created_at=_CREATED_AT - timedelta(seconds=1), updated_at=_CREATED_AT - timedelta(seconds=1))
    assert _ids(
        harness.get(kind, query={"start": "2024-01-15 14:30", "end": "2024-01-15 14:30", "sort_by": sort_by})
    ) == [expected.id]


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_empty_dates_remain_unbounded(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    conversation = _conversation(harness)
    assert _ids(harness.get(kind, query={"start": "", "end": ""})) == [conversation.id]


@pytest.mark.parametrize("field", ["query", "answer"])
@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_keyword_is_case_insensitive_and_escapes_wildcards(harness: _Harness, kind: _Kind, field: str) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    matching = _conversation(
        harness,
        query="Literal 50%_done" if field == "query" else "First question",
        answer="Literal 50%_done" if field == "answer" else "First answer",
    )
    _conversation(harness, query="50XYZdone", answer="50XYZdone")
    assert _ids(harness.get(kind, query={"keyword": "50%_DONE"})) == [matching.id]


@pytest.mark.parametrize("filter_value", ["annotated", "not_annotated"])
@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_annotation_filter(harness: _Harness, kind: _Kind, filter_value: str) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    annotated = _conversation(harness)
    plain = _conversation(harness)
    with harness.factory.begin() as session:
        session.add(
            MessageAnnotation(
                app_id=harness.target.id,
                conversation_id=annotated.id,
                account_id=harness.account.id,
                content="Annotation",
                question="Question",
            )
        )
    assert _ids(harness.get(kind, query={"annotation_status": filter_value})) == [
        annotated.id if filter_value == "annotated" else plain.id
    ]


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_chat_modes_and_debugger_visibility(harness: _Harness, mode: AppMode) -> None:
    harness.mode(mode)
    published = _conversation(harness)
    debugger = _conversation(harness, invoke_from="debugger")
    expected = {published.id} if mode == AppMode.ADVANCED_CHAT else {published.id, debugger.id}
    assert set(_ids(harness.get("chat"))) == expected


@pytest.mark.parametrize(
    ("kind", "mode"), [("chat", AppMode.COMPLETION), ("chat", AppMode.WORKFLOW), ("completion", AppMode.CHAT)]
)
def test_unavailable_app_is_rejected_before_query_validation(harness: _Harness, kind: _Kind, mode: AppMode) -> None:
    harness.mode(mode)
    response = harness.get(kind, query={"limit": 0})
    assert response.status_code == 404
    assert response.get_json()["code"] == "app_not_found"
    assert "App mode is not in the supported list" in response.get_json()["message"]


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_another_tenants_app_is_not_visible(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    with harness.factory.begin() as session:
        target = session.get(App, harness.target.id)
        assert target is not None
        target.tenant_id = str(uuid4())
    response = harness.get(kind)
    assert response.status_code == 404
    assert response.get_json()["code"] == "app_not_found"


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
def test_existing_edit_roles_are_preserved(harness: _Harness, role: TenantAccountRole) -> None:
    with harness.factory.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id))
        assert membership is not None
        membership.role = role
    response = harness.get("chat")
    assert response.status_code == (200 if TenantAccountRole.is_editing_role(role) else 403)


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_login_and_csrf_remain_required(harness: _Harness, kind: _Kind) -> None:
    assert harness.get(kind, authenticated=False).status_code == 401
    assert harness.get(kind, csrf=False).status_code == 401


@pytest.mark.parametrize("handler", [ChatConversationApi.get, CompletionConversationApi.get])
def test_app_view_layout_rbac_check_is_declared(handler: Callable[..., object]) -> None:
    checks: tuple[RBACCheck, ...] = vars(handler)[RBAC_CHECKS_ATTR]
    assert len(checks) == 1
    assert checks[0].scene == RBACPermission.APP_VIEW_LAYOUT
    assert isinstance(checks[0].locator, PlainApp)
    assert checks[0].locator.param == "app_id"


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_account_removed_after_authentication_is_unauthorized(harness: _Harness, kind: _Kind) -> None:
    harness.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)

    def delete_account() -> None:
        with harness.factory.begin() as session:
            account = session.get(Account, harness.account.id)
            assert account is not None
            session.delete(account)

    harness.after_account_load = delete_account
    response = harness.get(kind)
    assert response.status_code == 401
    assert response.get_json()["code"] == "unauthorized"
    assert response.get_json()["message"]
