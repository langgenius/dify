"""Explore message HTTP contracts through real admission, services and SQLite."""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import Connection, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.explore.message as module
from core.app.entities.app_invoke_entities import InvokeFrom
from models import App, AppMode, InstalledApp
from models.enums import ConversationFromSource, ConversationStatus, FeedbackFromSource, FeedbackRating
from models.model import Conversation, Message, MessageFeedback
from repositories.installed_app_message_repository import SQLAlchemyInstalledAppMessageRepository
from services.installed_app_message_service import InstalledAppMessageService, MessageFeedbackEvent
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import (
    _assert_json_response,
    _Harness,
    harness,
)

__all__ = ["harness"]

_CREATED_AT = datetime(2024, 1, 1)
type _Operation = Literal["list", "feedback"]
_OPERATIONS: tuple[_Operation, ...] = ("list", "feedback")


@dataclass(frozen=True)
class _InstalledAppServices:
    messages: InstalledAppMessageService


@dataclass(frozen=True)
class _Services:
    installed_apps: _InstalledAppServices


@dataclass
class _Messages:
    harness: _Harness
    factory: sessionmaker[Session]
    services: _Services = field(init=False)
    sessions: list[Session] = field(default_factory=list)
    extras: dict[str, list[dict[str, JsonValue]]] = field(default_factory=dict)
    extra_calls: list[list[str]] = field(default_factory=list)
    feedback_events: list[MessageFeedbackEvent] = field(default_factory=list)

    def assert_sessions_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def get_extra_contents(self, *, message_ids: Sequence[str]) -> Mapping[str, list[dict[str, JsonValue]]]:
        self.assert_sessions_closed()
        self.extra_calls.append(list(message_ids))
        return self.extras

    def emit_feedback(self, *, feedback: MessageFeedbackEvent) -> None:
        self.assert_sessions_closed()
        with self.factory() as session:
            persisted = session.scalar(select(MessageFeedback).where(MessageFeedback.message_id == feedback.message_id))
            assert persisted is not None
            assert persisted.rating.value == feedback.rating
            assert persisted.content == feedback.content
        self.feedback_events.append(feedback)

    def request(
        self,
        operation: _Operation,
        *,
        conversation_id: str = "",
        message_id: str | None = None,
        installed_app_id: str | None = None,
        query: str | None = None,
        body: dict[str, object] | None = None,
    ) -> TestResponse:
        url = f"/installed-apps/{installed_app_id or self.harness.installed_app.id}/messages"
        if operation == "list":
            url += f"?conversation_id={conversation_id}"
            if query:
                url += f"&{query}"
        else:
            url += f"/{message_id or uuid4()}/feedbacks"
        return self.harness.app.test_client().open(url, method="POST" if operation == "feedback" else "GET", json=body)


@pytest.fixture
def messages(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> _Messages:
    factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)
    state = _Messages(harness=harness, factory=factory)
    _set_mode(state, AppMode.CHAT)

    @event.listens_for(factory, "after_begin")
    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        state.sessions.append(session)

    state.services = _Services(
        installed_apps=_InstalledAppServices(
            messages=InstalledAppMessageService(
                messages=SQLAlchemyInstalledAppMessageRepository(session_factory=factory),
                get_extra_contents=state.get_extra_contents,
                emit_feedback=state.emit_feedback,
            ),
        ),
    )
    monkeypatch.setattr(module, "application_services", lambda: state.services)
    for resource, suffix in (
        (module.MessageListApi, ""),
        (module.MessageFeedbackApi, "/<uuid:message_id>/feedbacks"),
    ):
        harness.api.add_resource(resource, f"/installed-apps/<uuid:installed_app_id>/messages{suffix}")
    return state


def _set_mode(state: _Messages, mode: AppMode) -> None:
    with state.factory.begin() as session:
        app = session.get(App, state.harness.target_app.id)
        assert app is not None
        app.mode = mode


def _conversation(
    state: _Messages,
    *,
    app_id: str | None = None,
    account_id: str | None = None,
    source: ConversationFromSource = ConversationFromSource.CONSOLE,
    end_user_id: str | None = None,
    is_deleted: bool = False,
) -> Conversation:
    conversation = Conversation(
        app_id=app_id or state.harness.target_app.id,
        mode=AppMode.CHAT,
        name="Conversation",
        status=ConversationStatus.NORMAL,
        _inputs={},
        from_source=source,
        from_account_id=account_id or state.harness.account.id,
        from_end_user_id=end_user_id,
        invoke_from=InvokeFrom.EXPLORE,
        is_deleted=is_deleted,
    )
    with state.factory.begin() as session:
        session.add(conversation)
    return conversation


def _message(
    state: _Messages,
    conversation: Conversation,
    *,
    age: int = 0,
    app_id: str | None = None,
    account_id: str | None = None,
    source: ConversationFromSource = ConversationFromSource.CONSOLE,
    end_user_id: str | None = None,
) -> Message:
    message = Message(
        app_id=app_id or conversation.app_id,
        conversation_id=conversation.id,
        _inputs={"zero": 0, "disabled": False, "null": None, "empty": []},
        query="Hello",
        message={},
        answer="你好",
        message_tokens=2,
        answer_tokens=3,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        total_price=Decimal(0),
        provider_response_latency=0,
        currency="USD",
        status="normal",
        message_metadata=json.dumps({"retriever_resources": [], "zero": 0}),
        from_source=source,
        from_account_id=account_id or state.harness.account.id,
        from_end_user_id=end_user_id,
        created_at=_CREATED_AT - timedelta(minutes=age),
    )
    with state.factory.begin() as session:
        session.add(message)
    return message


def _error(response: TestResponse, *, status: int, code: str, message: str | None = None) -> None:
    assert response.status_code == status
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["message"], str)
    assert body["message"]
    if message is not None:
        assert body["message"] == message
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)


def test_list_preserves_response_and_fetches_older_messages_in_display_order(messages: _Messages) -> None:
    conversation = _conversation(messages)
    oldest = _message(messages, conversation, age=2)
    middle = _message(messages, conversation, age=1)
    newest = _message(messages, conversation)
    messages.extras[middle.id] = [{"type": "human_input", "workflow_run_id": "workflow-1", "submitted": False}]
    with messages.factory.begin() as session:
        session.add_all(
            [
                MessageFeedback(
                    app_id=newest.app_id,
                    conversation_id=conversation.id,
                    message_id=newest.id,
                    rating=rating,
                    from_source=source,
                )
                for rating, source in (
                    (FeedbackRating.LIKE, FeedbackFromSource.ADMIN),
                    (FeedbackRating.DISLIKE, FeedbackFromSource.USER),
                )
            ]
        )
    response = messages.request("list", conversation_id=conversation.id, query="limit=2")
    body = response.get_json()
    assert response.status_code == 200
    assert body["limit"] == 2
    assert body["has_more"] is True
    assert [item["id"] for item in body["data"]] == [middle.id, newest.id]
    assert body["data"][0]["extra_contents"] == [
        {
            "type": "human_input",
            "workflow_run_id": "workflow-1",
            "submitted": False,
            "form_definition": None,
            "form_submission_data": None,
        }
    ]
    assert body["data"][1] == {
        "id": newest.id,
        "conversation_id": conversation.id,
        "parent_message_id": None,
        "inputs": {"zero": 0, "disabled": False, "null": None, "empty": []},
        "query": "Hello",
        "answer": "你好",
        "feedback": {"rating": "dislike"},
        "retriever_resources": [],
        "created_at": int(_CREATED_AT.timestamp()),
        "agent_thoughts": [],
        "message_files": [],
        "message_tokens": 2,
        "answer_tokens": 3,
        "provider_response_latency": 0.0,
        "total_price": "0E-7",
        "currency": "USD",
        "status": "normal",
        "error": None,
        "extra_contents": [],
        "total_tokens": 5,
        "metadata": {"retriever_resources": [], "zero": 0},
    }
    _assert_json_response(response, status=200, body=body)
    response = messages.request("list", conversation_id=conversation.id, query=f"limit=2&first_id={middle.id}")
    assert response.get_json()["has_more"] is False
    assert [item["id"] for item in response.get_json()["data"]] == [oldest.id]
    assert messages.extra_calls == [[middle.id, newest.id], [oldest.id]]
    messages.assert_sessions_closed()


@pytest.mark.parametrize("empty_conversation_id", [False, True])
def test_empty_list_keeps_defaults_and_avoids_extra_content_io(
    messages: _Messages, empty_conversation_id: bool
) -> None:
    conversation = _conversation(messages)
    _assert_json_response(
        messages.request("list", conversation_id="" if empty_conversation_id else conversation.id),
        status=200,
        body={"limit": 20, "has_more": False, "data": []},
    )
    assert messages.extra_calls == []


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "limit=invalid", "first_id=invalid"])
def test_invalid_list_query_uses_shared_422(messages: _Messages, query: str) -> None:
    _error(messages.request("list", conversation_id=str(uuid4()), query=query), status=422, code="unprocessable_entity")
    assert messages.extra_calls == []


@pytest.mark.parametrize("owner", ["app", "account", "source", "end_user", "deleted", "missing"])
def test_list_requires_conversation_ownership(messages: _Messages, owner: str) -> None:
    conversation = _conversation(
        messages,
        app_id=str(uuid4()) if owner == "app" else None,
        account_id=str(uuid4()) if owner == "account" else None,
        source=ConversationFromSource.API if owner == "source" else ConversationFromSource.CONSOLE,
        end_user_id=str(uuid4()) if owner == "end_user" else None,
        is_deleted=owner == "deleted",
    )
    _error(
        messages.request("list", conversation_id=str(uuid4()) if owner == "missing" else conversation.id),
        status=404,
        code="conversation_not_found",
    )
    assert messages.extra_calls == []


def test_list_rejects_cursor_from_another_conversation(messages: _Messages) -> None:
    conversation = _conversation(messages)
    foreign = _message(messages, _conversation(messages))
    _error(
        messages.request("list", conversation_id=conversation.id, query=f"first_id={foreign.id}"),
        status=404,
        code="message_cursor_not_found",
    )
    assert messages.extra_calls == []


def test_feedback_create_update_revoke_persists_before_telemetry(messages: _Messages) -> None:
    message = _message(messages, _conversation(messages))
    for rating, content in (("like", ""), ("dislike", "Changed my mind")):
        _assert_json_response(
            messages.request("feedback", message_id=message.id, body={"rating": rating, "content": content}),
            status=200,
            body={"result": "success"},
        )
        with messages.factory() as session:
            rows = session.scalars(select(MessageFeedback)).all()
            assert len(rows) == 1
            assert rows[0].rating.value == rating
            assert rows[0].content == content
            assert rows[0].from_source == FeedbackFromSource.ADMIN
            assert rows[0].from_account_id == messages.harness.account.id
            assert rows[0].from_end_user_id is None
    _assert_json_response(
        messages.request("feedback", message_id=message.id, body={"rating": None}),
        status=200,
        body={"result": "success"},
    )
    with messages.factory() as session:
        assert session.scalars(select(MessageFeedback)).all() == []
    assert [feedback.rating for feedback in messages.feedback_events] == ["like", "dislike"]
    assert all(
        feedback.tenant_id == messages.harness.target_app.tenant_id
        and feedback.app_id == message.app_id
        and feedback.conversation_id == message.conversation_id
        and feedback.message_id == message.id
        and feedback.account_id == messages.harness.account.id
        for feedback in messages.feedback_events
    )


def test_revoke_without_feedback_has_specific_400(messages: _Messages) -> None:
    message = _message(messages, _conversation(messages))
    _error(
        messages.request("feedback", message_id=message.id, body={"rating": None}),
        status=400,
        code="message_feedback_rating_required",
    )
    assert messages.feedback_events == []


@pytest.mark.parametrize("owner", ["app", "account", "source", "end_user", "missing"])
def test_feedback_requires_complete_message_ownership(messages: _Messages, owner: str) -> None:
    message = _message(
        messages,
        _conversation(messages),
        app_id=str(uuid4()) if owner == "app" else None,
        account_id=str(uuid4()) if owner == "account" else None,
        source=ConversationFromSource.API if owner == "source" else ConversationFromSource.CONSOLE,
        end_user_id=str(uuid4()) if owner == "end_user" else None,
    )
    _error(
        messages.request(
            "feedback", message_id=str(uuid4()) if owner == "missing" else message.id, body={"rating": "like"}
        ),
        status=404,
        code="message_not_found",
    )
    assert messages.feedback_events == []
    with messages.factory() as session:
        assert session.scalars(select(MessageFeedback)).all() == []


@pytest.mark.parametrize("mode", list(AppMode))
def test_feedback_accepts_every_app_mode(messages: _Messages, mode: AppMode) -> None:
    _set_mode(messages, mode)
    message = _message(messages, _conversation(messages))
    _assert_json_response(
        messages.request("feedback", message_id=message.id, body={"rating": "like"}),
        status=200,
        body={"result": "success"},
    )


@pytest.mark.parametrize("body", [{"rating": "invalid"}, {"content": 123}])
def test_invalid_feedback_uses_shared_422(messages: _Messages, body: dict[str, object]) -> None:
    _error(messages.request("feedback", body=body), status=422, code="unprocessable_entity")
    assert messages.feedback_events == []


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize("admission", ["missing", "denied", "wrong-workspace"])
def test_all_message_handlers_apply_installed_app_admission(
    messages: _Messages, operation: _Operation, admission: str
) -> None:
    if admission == "denied":
        messages.harness.state.allowed = False
    elif admission == "wrong-workspace":
        with messages.factory.begin() as session:
            session.execute(
                update(InstalledApp)
                .where(InstalledApp.id == messages.harness.installed_app.id)
                .values(tenant_id=str(uuid4()))
            )
    _error(
        messages.request(operation, installed_app_id=str(uuid4()) if admission == "missing" else None),
        status=403 if admission == "denied" else 404,
        code="access_denied" if admission == "denied" else "installed_app_not_found",
    )
    assert messages.extra_calls == messages.feedback_events == []


def test_list_mode_rejection_precedes_message_queries(messages: _Messages) -> None:
    _set_mode(messages, AppMode.COMPLETION)
    _error(messages.request("list"), status=400, code="not_chat_app")
    assert messages.extra_calls == []
