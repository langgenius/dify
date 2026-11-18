"""Console conversation lists through real account admission, services and SQLite."""

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from psycopg2.errors import QueryCanceled
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACCheck, RBACPermission
from controllers.console import wraps as console_wraps
from controllers.console.app import conversation as conversation_module
from controllers.console.app.conversation import (
    ChatConversationApi,
    CompletionConversationApi,
    ConversationLogExportApi,
    ConversationLogExportPreviewApi,
)
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
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
from repositories.conversation_repository import ConversationRepository, save_conversation_log_export_task
from services.conversation_query_service import ConversationQueryService
from services.message_query_adapters import MessageFileResolver
from services.retention.conversation.log_export_service import ConversationLogExportService, ConversationLogExportTask
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_message

type _Kind = Literal["chat", "completion", "export-preview"]
_CREATED_AT = datetime(2024, 1, 15, 6, 30, 0)


@dataclass(frozen=True)
class _Services:
    conversation_queries: ConversationQueryService
    conversation_log_exports: ConversationLogExportService


@dataclass
class _Harness:
    app: Flask
    factory: sessionmaker[Session]
    account: Account
    tenant: Tenant
    target: App
    redis: Mock = field(default_factory=lambda: Mock(spec=RedisClientWrapper))
    sessions: list[Session] = field(default_factory=list)
    after_account_load: Callable[[], None] | None = None

    def get(
        self,
        kind: _Kind,
        *,
        query: Mapping[str, str | int | list[str]] | None = None,
        app_id: str | None = None,
        authenticated: bool = True,
        csrf: bool = True,
    ) -> TestResponse:
        client, headers = self._client(authenticated=authenticated, csrf=csrf)
        resource = "conversation-log-exports/preview" if kind == "export-preview" else f"{kind}-conversations"
        response = client.get(f"/apps/{app_id or self.target.id}/{resource}", query_string=query, headers=headers)
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        assert response.content_type == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        return response

    def post_export(self, payload: object) -> TestResponse:
        """Create an export through the authenticated Console route."""
        client, headers = self._client(authenticated=True, csrf=True)
        return client.post(f"/apps/{self.target.id}/conversation-log-exports", json=payload, headers=headers)

    def _client(self, *, authenticated: bool, csrf: bool) -> tuple[FlaskClient, dict[str, str]]:
        """Return a test client and any headers for the requested admission state."""
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
        return client, headers

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

    conversations = ConversationRepository(session_factory=factory)
    app.extensions["application_services"] = _Services(
        conversation_queries=ConversationQueryService(
            files=MessageFileResolver(),
            conversations=conversations,
            restore_inputs=restore_input_files,
        ),
        conversation_log_exports=ConversationLogExportService(
            conversations=conversations,
            save_task=lambda task: save_conversation_log_export_task(task, redis=state.redis),
        ),
    )
    api = ExternalApi(app)
    api.add_resource(ChatConversationApi, "/apps/<uuid:app_id>/chat-conversations")
    api.add_resource(CompletionConversationApi, "/apps/<uuid:app_id>/completion-conversations")
    api.add_resource(ConversationLogExportPreviewApi, "/apps/<uuid:app_id>/conversation-log-exports/preview")
    api.add_resource(ConversationLogExportApi, "/apps/<uuid:app_id>/conversation-log-exports")
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


@pytest.mark.parametrize(
    ("mode", "expected_conversations", "expected_messages"),
    [(AppMode.CHAT, 3, 4), (AppMode.ADVANCED_CHAT, 2, 3), (AppMode.AGENT_CHAT, 3, 4), (AppMode.AGENT, 3, 4)],
)
def test_conversation_export_preview_counts_all_messages_in_matched_conversations(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    expected_conversations: int,
    expected_messages: int,
) -> None:
    harness.mode(mode)
    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", lambda _: True)
    matched = _conversation(harness, query="Needle", created_at=_CREATED_AT - timedelta(days=1))
    second = _conversation(harness, query="Needle", updated_at=_CREATED_AT.replace(second=59))
    debug = _conversation(harness, query="Needle", invoke_from="debugger")
    deleted = _conversation(harness, query="Needle", deleted=True)
    late = _conversation(harness, query="Needle", updated_at=_CREATED_AT + timedelta(minutes=1))
    _conversation(harness, query="Needle")  # No annotation.
    with harness.factory.begin() as session:
        session.add(
            make_message(
                app_id=harness.target.id,
                conversation_id=matched.id,
                query="Follow-up",
                answer="Other answer",
                message=[],
                from_source=ConversationFromSource.API,
                currency="USD",
            )
        )
        session.add_all(
            [
                MessageAnnotation(
                    app_id=harness.target.id,
                    conversation_id=row.id,
                    account_id=harness.account.id,
                    question="Reviewed",
                    content="Answer",
                )
                for row in (matched, matched, second, debug, deleted, late)
            ]
        )
    filters = {
        "keyword": "needle",
        "annotation_status": "annotated",
        "start": "2024-01-15 14:30",
        "end": "2024-01-15 14:30",
        "sort_by": "-updated_at",
    }
    page = harness.get("chat", query={**filters, "limit": 1})
    preview = harness.get("export-preview", query=filters)

    assert len(_ids(page)) == 1
    assert page.get_json()["total"] == expected_conversations
    assert preview.status_code == 200
    assert preview.get_json() == {
        "counts": {"conversation_count": expected_conversations, "message_count": expected_messages}
    }
    assert harness.get("export-preview", query={"keyword": "unmatched"}).get_json() == {
        "counts": {"conversation_count": 0, "message_count": 0}
    }


def test_list_and_export_preview_filter_by_selected_identities(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    harness.mode(AppMode.ADVANCED_CHAT)
    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", lambda _: True)
    selected_user_ids = [str(uuid4()), str(uuid4())]
    first, second = _conversation(harness), _conversation(harness)
    account = _conversation(harness, invoke_from="explore")
    other_user = _conversation(harness)
    other_app = _conversation(harness, app_id=str(uuid4()))
    with harness.factory.begin() as session:
        for conversation, user_id in (
            (first, selected_user_ids[0]),
            (second, selected_user_ids[1]),
            (other_user, str(uuid4())),
            (other_app, selected_user_ids[0]),
        ):
            stored = session.get_one(Conversation, conversation.id)
            stored.from_end_user_id = user_id
            stored.from_account_id = None
        session.get_one(Conversation, account.id).from_source = ConversationFromSource.CONSOLE

    for query, expected in (
        ({"end_user_ids": selected_user_ids}, {first.id, second.id}),
        ({"account_ids": [harness.account.id]}, {account.id}),
        ({"end_user_ids": selected_user_ids, "account_ids": [harness.account.id]}, {first.id, second.id, account.id}),
    ):
        page = harness.get("chat", query=query)
        preview = harness.get("export-preview", query=query)

        assert set(_ids(page)) == expected
        assert page.get_json()["total"] == len(expected)
        assert preview.status_code == 200
        assert preview.get_json() == {"counts": {"conversation_count": len(expected), "message_count": len(expected)}}


@pytest.mark.parametrize("kind", ["chat", "export-preview"])
def test_log_identity_filters_require_uuids(harness: _Harness, monkeypatch: pytest.MonkeyPatch, kind: _Kind) -> None:
    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", lambda _: True)
    response = harness.get(kind, query={"end_user_ids": ["invalid-user-id"]})
    assert response.status_code == 422
    assert response.get_json()["code"] == "unprocessable_entity"
    assert "invalid-user-id" not in response.get_json()["message"]


@pytest.mark.parametrize("create", [False, True], ids=["preview", "create"])
@pytest.mark.parametrize(
    ("mode", "role", "status", "code"),
    [
        (AppMode.ADVANCED_CHAT, TenantAccountRole.EDITOR, 403, "forbidden"),
        (AppMode.COMPLETION, TenantAccountRole.OWNER, 404, "app_not_found"),
        (AppMode.WORKFLOW, TenantAccountRole.OWNER, 404, "app_not_found"),
    ],
)
def test_conversation_export_checks_role_and_mode_before_billing(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    mode: AppMode,
    role: TenantAccountRole,
    status: int,
    code: str,
    create: bool,
) -> None:
    harness.mode(mode)
    config_overrides(RBAC_ENABLED=True)
    with harness.factory.begin() as session:
        membership = session.scalars(
            select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == harness.tenant.id)
        ).one()
        membership.role = role

    def allow_logs(*, checks: tuple[RBACCheck, ...], **_: object) -> None:
        (check,) = checks
        assert check.scene == RBACPermission.APP_LOG_AND_ANNOTATION
        assert isinstance(check.locator, PlainApp)

    def unexpected_billing(_: str) -> bool:
        pytest.fail("Role and app mode must be checked before billing.")

    monkeypatch.setattr("controllers.console.flask_admission.enforce_rbac_checks", allow_logs)
    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", unexpected_billing)

    response = harness.post_export({}) if create else harness.get("export-preview")
    assert response.status_code == status
    assert response.get_json()["code"] == code
    harness.redis.setex.assert_not_called()


@pytest.mark.parametrize("edition", list(DeploymentEdition))
@pytest.mark.parametrize("create", [False, True], ids=["preview", "create"])
def test_conversation_export_checks_paid_plan_only_in_cloud(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    create: bool,
) -> None:
    harness.mode(AppMode.ADVANCED_CHAT)
    config_overrides(DEPLOYMENT_EDITION=edition)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)

    def unpaid(tenant_id: str) -> bool:
        assert edition == DeploymentEdition.CLOUD
        assert tenant_id == harness.tenant.id
        return False

    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", unpaid)
    response = harness.post_export({}) if create else harness.get("export-preview")
    if edition == DeploymentEdition.CLOUD:
        assert response.status_code == 403
        assert response.get_json()["code"] == "paid_plan_required"
        harness.redis.setex.assert_not_called()
    elif create:
        assert response.status_code == 202
        harness.redis.setex.assert_called_once()
    else:
        assert response.status_code == 200
        assert response.get_json() == {"counts": {"conversation_count": 0, "message_count": 0}}


def test_create_conversation_log_export_persists_normalized_filters(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Store the caller, owned app and UTC filter bounds before acknowledging an export."""
    harness.mode(AppMode.ADVANCED_CHAT)
    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", lambda _: True)
    end_user_id = str(uuid4())
    response = harness.post_export(
        {
            "keyword": "invoice",
            "start": "2024-01-15 14:30",
            "end": "2024-01-15 15:00",
            "annotation_status": "annotated",
            "sort_by": "-created_at",
            "end_user_ids": [end_user_id],
            "account_ids": [harness.account.id],
        }
    )

    assert response.status_code == 202
    harness.redis.setex.assert_called_once()
    key, ttl, raw = harness.redis.setex.call_args.args
    task = ConversationLogExportTask.model_validate_json(raw)
    assert response.get_json() == {"task_id": str(UUID(task.task_id)), "status": "pending"}
    assert key == f"conversation_log_export:{harness.tenant.id}:{harness.target.id}:{task.task_id}"
    assert task.requested_by == harness.account.id
    assert task.status == "pending"
    assert task.expires_at - task.created_at == timedelta(days=1)
    assert 0 < ttl <= 24 * 60 * 60
    assert task.filters.keyword == "invoice"
    assert task.filters.start == datetime(2024, 1, 15, 6, 30, tzinfo=UTC)
    assert task.filters.end == datetime(2024, 1, 15, 7, 0, 59, tzinfo=UTC)
    assert task.filters.annotation_status == "annotated"
    assert task.filters.sort_by == "-created_at"
    assert task.filters.end_user_ids == (end_user_id,)
    assert task.filters.account_ids == (harness.account.id,)


@pytest.mark.parametrize(
    ("mode", "payload", "status", "code"),
    [
        (AppMode.CHAT, [], 422, "unprocessable_entity"),
        (AppMode.CHAT, {"end_user_ids": ["invalid-user-id"]}, 422, "unprocessable_entity"),
        (AppMode.AGENT, {}, 404, "app_not_found"),
    ],
)
def test_create_conversation_log_export_rejects_unsupported_requests(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, mode: AppMode, payload: object, status: int, code: str
) -> None:
    """Reject malformed filters and app modes without an exporter before writing Redis."""
    harness.mode(mode)
    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", lambda _: True)
    response = harness.post_export(payload)
    assert response.status_code == status
    assert response.get_json()["code"] == code
    assert "invalid-user-id" not in response.get_json()["message"]
    harness.redis.setex.assert_not_called()


def test_conversation_export_preview_reports_count_query_timeout(
    harness: _Harness, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    harness.mode(AppMode.ADVANCED_CHAT)
    monkeypatch.setattr(conversation_module, "is_cloud_edition_billing_paid_plan", lambda _: True)

    @event.listens_for(sqlite_engine, "before_cursor_execute")
    def cancel_count(_conn: Connection, _cursor: object, statement: str, *_: object) -> None:
        if statement.startswith("SELECT count(*)"):
            raise DBAPIError(statement, None, QueryCanceled("statement timeout"))

    response = harness.get("export-preview")
    assert response.status_code == 200
    assert response.get_json() == {"counts": None}


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
