"""Explore conversation HTTP contracts through real admission, services and SQLite."""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Connection, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.explore.conversation as module
from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import ConversationFromSource, ConversationStatus, CreatorUserRole
from models.model import App, AppMode, Conversation, Message
from models.web import PinnedConversation
from repositories.installed_app_conversation_repository import SQLAlchemyInstalledAppConversationRepository
from services.installed_app_conversation_service import InstalledAppConversationService
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import (
    _assert_json_response,
    _Harness,
    harness,
)

__all__ = ["harness"]

_CREATED_AT = datetime(2024, 1, 1)
_CREATED_TIMESTAMP = int(_CREATED_AT.timestamp())
type _Operation = Literal["list", "delete", "rename", "pin", "unpin"]
_OPERATIONS: tuple[_Operation, ...] = ("list", "delete", "rename", "pin", "unpin")


@dataclass(frozen=True)
class _Services:
    installed_app_conversations: InstalledAppConversationService


@dataclass
class _Conversations:
    harness: _Harness
    factory: sessionmaker[Session]
    sessions: list[Session] = field(default_factory=list)
    generation_calls: list[tuple[str, str, str, str, str]] = field(default_factory=list)
    cleanup_calls: list[tuple[str, str, str | None]] = field(default_factory=list)
    generation_error: Exception | None = None
    generation_action: Callable[[], None] | None = None

    def assert_sessions_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def generate_name(self, *, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
        self.assert_sessions_closed()
        self.generation_calls.append((tenant_id, app_id, conversation_id, query, app_mode))
        if self.generation_error is not None:
            raise self.generation_error
        if self.generation_action is not None:
            self.generation_action()
        return "Generated title"

    def enqueue_cleanup(self, *, tenant_id: str, conversation_id: str, retired_binding_id: str | None) -> None:
        self.assert_sessions_closed()
        with self.factory() as session:
            conversation = session.get(Conversation, conversation_id)
            assert conversation is not None
            assert conversation.is_deleted
        self.cleanup_calls.append((tenant_id, conversation_id, retired_binding_id))

    def request(
        self,
        operation: _Operation,
        *,
        conversation_id: str | None = None,
        installed_app_id: str | None = None,
        query: str = "",
        body: dict[str, object] | None = None,
    ) -> TestResponse:
        url = f"/installed-apps/{installed_app_id or self.harness.installed_app.id}/conversations"
        method = "GET"
        if operation != "list":
            url += f"/{conversation_id or uuid4()}"
            if operation == "delete":
                method = "DELETE"
            else:
                method = "POST" if operation == "rename" else "PATCH"
                url += "/name" if operation == "rename" else f"/{operation}"
        if query:
            url += f"?{query}"
        if operation == "rename" and body is None:
            body = {"name": "Renamed"}
        return self.harness.app.test_client().open(url, method=method, json=body)


@pytest.fixture
def conversations(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> _Conversations:
    factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)
    with factory.begin() as session:
        app = session.get(App, harness.target_app.id)
        assert app is not None
        app.mode = AppMode.CHAT
    state = _Conversations(harness=harness, factory=factory)

    @event.listens_for(factory, "after_begin")
    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        state.sessions.append(session)

    services = _Services(
        InstalledAppConversationService(
            conversations=SQLAlchemyInstalledAppConversationRepository(session_factory=factory),
            generate_name=state.generate_name,
            enqueue_delete_cleanup=state.enqueue_cleanup,
        )
    )
    monkeypatch.setattr(module, "application_services", lambda: services)
    routes = (
        (module.ConversationListApi, ""),
        (module.ConversationApi, "/<uuid:c_id>"),
        (module.ConversationRenameApi, "/<uuid:c_id>/name"),
        (module.ConversationPinApi, "/<uuid:c_id>/pin"),
        (module.ConversationUnPinApi, "/<uuid:c_id>/unpin"),
    )
    for resource, suffix in routes:
        harness.api.add_resource(resource, f"/installed-apps/<uuid:installed_app_id>/conversations{suffix}")
    return state


def _conversation(
    state: _Conversations,
    *,
    age: int = 0,
    app_id: str | None = None,
    account_id: str | None = None,
    source: ConversationFromSource = ConversationFromSource.CONSOLE,
    end_user_id: str | None = None,
    invoke_from: InvokeFrom | None = InvokeFrom.EXPLORE,
    is_deleted: bool = False,
) -> Conversation:
    conversation = Conversation(
        app_id=app_id or state.harness.target_app.id,
        mode=AppMode.CHAT,
        name="Original title",
        status=ConversationStatus.NORMAL,
        _inputs={"text": "hello", "count": 0, "enabled": False, "optional": None, "items": []},
        introduction=None,
        from_source=source,
        from_account_id=account_id or state.harness.account.id,
        from_end_user_id=end_user_id,
        invoke_from=invoke_from,
        is_deleted=is_deleted,
        created_at=_CREATED_AT,
        updated_at=_CREATED_AT - timedelta(minutes=age),
    )
    with state.factory.begin() as session:
        session.add(conversation)
    return conversation


def _message(state: _Conversations, conversation: Conversation, *, query: str = "First question", age: int = 0) -> None:
    with state.factory.begin() as session:
        session.add(
            Message(
                app_id=conversation.app_id,
                conversation_id=conversation.id,
                _inputs={},
                query=query,
                message={},
                answer="answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=state.harness.account.id,
                created_at=_CREATED_AT + timedelta(minutes=age),
            )
        )


def _pin(state: _Conversations, conversation: Conversation, *, account_id: str | None = None) -> None:
    with state.factory.begin() as session:
        session.add(
            PinnedConversation(
                app_id=conversation.app_id,
                conversation_id=conversation.id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account_id or state.harness.account.id,
            )
        )


def _error(response: TestResponse, *, status: int, code: str) -> None:
    assert response.status_code == status
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["message"], str)
    assert body["message"]
    assert response.headers["Content-Type"] == "application/json"


def test_list_preserves_response_fields_values_and_timestamp_pagination(conversations: _Conversations) -> None:
    first = _conversation(conversations)
    second = _conversation(conversations, age=1)
    response = conversations.request("list", query="limit=1")
    _assert_json_response(
        response,
        status=200,
        body={
            "limit": 1,
            "has_more": True,
            "data": [
                {
                    "id": first.id,
                    "name": "Original title",
                    "inputs": {"text": "hello", "count": 0, "enabled": False, "optional": None, "items": []},
                    "status": "normal",
                    "introduction": None,
                    "created_at": _CREATED_TIMESTAMP,
                    "updated_at": _CREATED_TIMESTAMP,
                }
            ],
        },
    )
    response = conversations.request("list", query=f"limit=1&last_id={first.id}")
    assert response.status_code == 200
    assert response.get_json()["has_more"] is False
    assert [item["id"] for item in response.get_json()["data"]] == [second.id]
    conversations.assert_sessions_closed()


@pytest.mark.parametrize(("query", "limit"), [("", 20), ("limit=invalid", 20), ("limit=", 20), ("limit=100", 100)])
def test_list_retains_default_and_invalid_string_limit_fallback(
    conversations: _Conversations, query: str, limit: int
) -> None:
    _assert_json_response(
        conversations.request("list", query=query), status=200, body={"limit": limit, "has_more": False, "data": []}
    )


@pytest.mark.parametrize("query", ["limit=0", "limit=-1", "limit=101", "last_id=invalid"])
def test_invalid_query_uses_shared_validation_error(conversations: _Conversations, query: str) -> None:
    _error(conversations.request("list", query=query), status=422, code="unprocessable_entity")


@pytest.mark.parametrize("pinned", ["true", "false", "TRUE", "1", ""])
def test_list_preserves_literal_true_pinned_filter(conversations: _Conversations, pinned: str) -> None:
    pinned_conversation = _conversation(conversations)
    unpinned = _conversation(conversations, age=1)
    _pin(conversations, pinned_conversation)
    response = conversations.request("list", query=f"pinned={pinned}")
    assert response.status_code == 200
    expected = pinned_conversation.id if pinned == "true" else unpinned.id
    assert [item["id"] for item in response.get_json()["data"]] == [expected]


def test_list_hides_other_account_app_source_end_user_deleted_and_debugger_conversations(
    conversations: _Conversations,
) -> None:
    visible = _conversation(conversations)
    legacy = _conversation(conversations, age=1, invoke_from=None)
    _conversation(conversations, app_id=str(uuid4()))
    _conversation(conversations, account_id=str(uuid4()))
    _conversation(conversations, source=ConversationFromSource.API)
    _conversation(conversations, end_user_id=str(uuid4()))
    _conversation(conversations, is_deleted=True)
    _conversation(conversations, invoke_from=InvokeFrom.DEBUGGER)
    response = conversations.request("list")
    assert response.status_code == 200
    assert [item["id"] for item in response.get_json()["data"]] == [visible.id, legacy.id]


def test_cursor_not_in_current_conversations_has_specific_error(conversations: _Conversations) -> None:
    foreign = _conversation(conversations, account_id=str(uuid4()))
    _error(
        conversations.request("list", query=f"last_id={foreign.id}"), status=404, code="conversation_cursor_not_found"
    )


def test_manual_rename_keeps_inputs_and_persists_name(conversations: _Conversations) -> None:
    conversation = _conversation(conversations)
    response = conversations.request("rename", conversation_id=conversation.id, body={"name": "  User title  "})
    assert response.status_code == 200
    assert response.get_json()["id"] == conversation.id
    assert response.get_json()["name"] == "  User title  "
    assert response.get_json()["inputs"] == conversation._inputs
    assert response.get_json()["created_at"] == _CREATED_TIMESTAMP
    assert response.get_json()["updated_at"] >= _CREATED_TIMESTAMP
    with conversations.factory() as session:
        persisted = session.get(Conversation, conversation.id)
        assert persisted is not None
        assert persisted.name == "  User title  "
    assert conversations.generation_calls == []


@pytest.mark.parametrize("body", [{}, {"name": " "}, {"name": 123}, {"auto_generate": "invalid"}])
def test_invalid_rename_uses_shared_validation_error(conversations: _Conversations, body: dict[str, object]) -> None:
    conversation = _conversation(conversations)
    _error(
        conversations.request("rename", conversation_id=conversation.id, body=body),
        status=422,
        code="unprocessable_entity",
    )


@pytest.mark.parametrize("fail_generation", [False, True])
def test_auto_rename_uses_first_message_after_sessions_close_and_preserves_name_on_failure(
    conversations: _Conversations, fail_generation: bool
) -> None:
    conversation = _conversation(conversations)
    _message(conversations, conversation)
    _message(conversations, conversation, query="Later question", age=1)
    if fail_generation:
        conversations.generation_error = RuntimeError("provider unavailable")
    response = conversations.request("rename", conversation_id=conversation.id, body={"auto_generate": True})
    assert response.status_code == 200
    assert response.get_json()["name"] == ("Original title" if fail_generation else "Generated title")
    assert response.get_json()["inputs"] == conversation._inputs
    assert conversations.generation_calls == [
        (conversations.harness.target_app.tenant_id, conversation.app_id, conversation.id, "First question", "chat")
    ]
    conversations.assert_sessions_closed()


def test_auto_rename_without_messages_returns_specific_error(conversations: _Conversations) -> None:
    conversation = _conversation(conversations)
    _error(
        conversations.request("rename", conversation_id=conversation.id, body={"auto_generate": True}),
        status=404,
        code="conversation_first_message_not_found",
    )
    assert conversations.generation_calls == []


def test_delete_returns_empty_204_after_commit_and_closed_sessions(conversations: _Conversations) -> None:
    conversation = _conversation(conversations)
    response = conversations.request("delete", conversation_id=conversation.id)
    assert response.status_code == 204
    assert response.data == b""
    assert response.headers["Content-Type"] == "application/json"
    assert "Content-Length" not in response.headers
    assert conversations.cleanup_calls == [(conversations.harness.target_app.tenant_id, conversation.id, None)]
    conversations.assert_sessions_closed()
    _error(conversations.request("delete", conversation_id=conversation.id), status=404, code="conversation_not_found")
    assert len(conversations.cleanup_calls) == 1


def test_pin_and_unpin_are_idempotent_and_preserve_other_accounts_pin(conversations: _Conversations) -> None:
    conversation = _conversation(conversations)
    other_account_id = str(uuid4())
    _pin(conversations, conversation, account_id=other_account_id)
    for operation in ("pin", "pin", "unpin", "unpin"):
        _assert_json_response(
            conversations.request(operation, conversation_id=conversation.id), status=200, body={"result": "success"}
        )
    _assert_json_response(
        conversations.request("unpin", conversation_id=str(uuid4())), status=200, body={"result": "success"}
    )
    with conversations.factory() as session:
        pins = session.scalars(select(PinnedConversation)).all()
        assert [(pin.conversation_id, pin.created_by) for pin in pins] == [(conversation.id, other_account_id)]


@pytest.mark.parametrize("operation", ["delete", "rename", "pin"])
@pytest.mark.parametrize("owner", ["app", "account", "source", "end_user", "deleted", "missing"])
def test_conversation_mutations_reject_other_owner_and_missing_rows(
    conversations: _Conversations, operation: _Operation, owner: str
) -> None:
    conversation = _conversation(
        conversations,
        app_id=str(uuid4()) if owner == "app" else None,
        account_id=str(uuid4()) if owner == "account" else None,
        source=ConversationFromSource.API if owner == "source" else ConversationFromSource.CONSOLE,
        end_user_id=str(uuid4()) if owner == "end_user" else None,
        is_deleted=owner == "deleted",
    )
    _error(
        conversations.request(operation, conversation_id=str(uuid4()) if owner == "missing" else conversation.id),
        status=404,
        code="conversation_not_found",
    )
    assert conversations.cleanup_calls == conversations.generation_calls == []


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize("admission", ["missing", "denied", "mode"])
def test_all_conversation_handlers_apply_installed_app_admission_and_chat_mode(
    conversations: _Conversations, operation: _Operation, admission: str
) -> None:
    conversation = _conversation(conversations)
    installed_app_id: str | None = None
    if admission == "missing":
        installed_app_id = str(uuid4())
    elif admission == "denied":
        conversations.harness.state.allowed = False
    else:
        with conversations.factory.begin() as session:
            app = session.get(App, conversations.harness.target_app.id)
            assert app is not None
            app.mode = AppMode.COMPLETION
    status, code = {
        "missing": (404, "installed_app_not_found"),
        "denied": (403, "access_denied"),
        "mode": (400, "not_chat_app"),
    }[admission]
    _error(
        conversations.request(operation, conversation_id=conversation.id, installed_app_id=installed_app_id),
        status=status,
        code=code,
    )
    assert conversations.cleanup_calls == conversations.generation_calls == []


@pytest.mark.parametrize("operation", _OPERATIONS)
def test_app_removed_after_admission_reports_missing_installation(
    conversations: _Conversations, operation: _Operation
) -> None:
    conversation = _conversation(conversations)

    def remove_app() -> None:
        with conversations.factory.begin() as session:
            app = session.get(App, conversations.harness.target_app.id)
            assert app is not None
            session.delete(app)

    conversations.harness.state.permission_action = remove_app
    _error(
        conversations.request(operation, conversation_id=conversation.id), status=404, code="installed_app_not_found"
    )
    assert conversations.cleanup_calls == conversations.generation_calls == []


def test_auto_rename_uses_mode_captured_before_permission_check(conversations: _Conversations) -> None:
    conversation = _conversation(conversations)
    _message(conversations, conversation)

    def change_mode() -> None:
        with conversations.factory.begin() as session:
            app = session.get(App, conversations.harness.target_app.id)
            assert app is not None
            app.mode = AppMode.ADVANCED_CHAT

    conversations.harness.state.permission_action = change_mode
    response = conversations.request("rename", conversation_id=conversation.id, body={"auto_generate": True})

    assert response.status_code == 200
    assert response.get_json()["name"] == "Generated title"
    assert conversations.generation_calls == [
        (conversations.harness.target_app.tenant_id, conversation.app_id, conversation.id, "First question", "chat")
    ]


def test_delete_commit_failure_rolls_back_and_does_not_enqueue(conversations: _Conversations) -> None:
    conversation = _conversation(conversations)
    conversations.harness.app.config["PROPAGATE_EXCEPTIONS"] = False

    @event.listens_for(conversations.factory, "before_commit", once=True)
    def fail_commit(session: Session) -> None:
        session.flush()
        raise RuntimeError("commit failed")

    response = conversations.request("delete", conversation_id=conversation.id)
    assert response.status_code == 500
    assert conversations.cleanup_calls == []
    conversations.assert_sessions_closed()
    with conversations.factory() as session:
        persisted = session.get(Conversation, conversation.id)
        assert persisted is not None
        assert persisted.is_deleted is False


def test_conversation_deleted_during_generation_is_not_renamed_or_resurrected(conversations: _Conversations) -> None:
    conversation = _conversation(conversations)
    _message(conversations, conversation)

    def delete_during_generation() -> None:
        with conversations.factory.begin() as session:
            persisted = session.get(Conversation, conversation.id)
            assert persisted is not None
            persisted.is_deleted = True

    conversations.generation_action = delete_during_generation
    _error(
        conversations.request("rename", conversation_id=conversation.id, body={"auto_generate": True}),
        status=404,
        code="conversation_not_found",
    )
    with conversations.factory() as session:
        persisted = session.get(Conversation, conversation.id)
        assert persisted is not None
        assert persisted.is_deleted is True
        assert persisted.name == "Original title"
    conversations.assert_sessions_closed()
