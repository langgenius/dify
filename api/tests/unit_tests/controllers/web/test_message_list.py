"""Web message history through real passport admission and detached SQLite reads."""

import json
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta
from decimal import Decimal
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import override
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, update
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from core.helper import http_client_pooling
from graphon.file import FileTransferMethod, FileType
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    FeedbackFromSource,
    FeedbackRating,
    MessageFileBelongsTo,
)
from models.model import App, AppMode, Conversation, EndUser, Message, MessageAgentThought, MessageFeedback, MessageFile
from tests.unit_tests.controllers.web.test_message_feedback import _Harness
from tests.unit_tests.controllers.web.test_message_feedback import harness as admission_harness
from tests.unit_tests.model_factories import make_message

harness = admission_harness


@pytest.fixture
def remote_files(
    harness: _Harness, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[str, list[tuple[str, str, bool]]]]:
    config_overrides(SSRF_PROXY_HTTP_URL="", SSRF_PROXY_HTTPS_URL="", SSRF_PROXY_ALL_URL="")
    requests: list[tuple[str, str, bool]] = []

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_HEAD(self) -> None:
            requests.append((self.command, self.path, any(session.in_transaction() for session in harness.sessions)))
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", "42")
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''downloaded%20image.png")
            self.end_headers()

    http_pool = http_client_pooling.HttpClientPoolFactory()
    monkeypatch.setattr(http_client_pooling, "_factory", http_pool)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        http_pool.close_all()


def _get(harness: _Harness, **query: object) -> TestResponse:
    return harness.app.test_client().get(
        "/messages",
        query_string={"conversation_id": harness.message.conversation_id, **query},
        headers=harness.headers,
    )


def test_message_list_preserves_wire_shape_and_loaded_relationships(
    harness: _Harness, remote_files: tuple[str, list[tuple[str, str, bool]]]
) -> None:
    remote_url, requests = remote_files
    created_at = datetime(2024, 1, 1, 12)
    thought = MessageAgentThought(
        message_id=harness.message.id,
        message_chain_id=str(uuid4()),
        position=1,
        created_by_role=CreatorUserRole.END_USER,
        created_by=harness.end_user.id,
        thought="thinking",
        tool="search",
        tool_labels_str='{"search": "Search"}',
        message_files='["file-a"]',
    )
    thought.created_at = created_at
    attachment = MessageFile(
        message_id=harness.message.id,
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        created_by_role=CreatorUserRole.END_USER,
        created_by=harness.end_user.id,
        belongs_to=MessageFileBelongsTo.USER,
        url=f"{remote_url}/user-image.png",
    )
    assistant_attachment = MessageFile(
        message_id=harness.message.id,
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        created_by_role=CreatorUserRole.END_USER,
        created_by=harness.end_user.id,
        belongs_to=MessageFileBelongsTo.ASSISTANT,
        url=f"{remote_url}/assistant-image.png",
    )
    resource_id = str(uuid4())
    metadata = {
        "custom": "metadata",
        "retriever_resources": [{"id": resource_id, "message_id": harness.message.id, "position": 1}],
    }
    with harness.factory.begin() as session:
        session.execute(
            update(Message)
            .where(Message.id == harness.message.id)
            .values(
                {
                    Message._inputs: {"text": "hello", "nested": {"value": [1, None]}},
                    Message.message_metadata: json.dumps(metadata),
                    Message.created_at: created_at,
                    Message.message_tokens: 3,
                    Message.answer_tokens: 5,
                    Message.total_price: Decimal("0.0012"),
                    Message.provider_response_latency: 0.25,
                }
            )
        )
        session.add_all(
            [
                thought,
                attachment,
                assistant_attachment,
                MessageFeedback(
                    app_id=harness.target.id,
                    conversation_id=harness.message.conversation_id,
                    message_id=harness.message.id,
                    rating=FeedbackRating.LIKE,
                    from_source=FeedbackFromSource.USER,
                    from_end_user_id=harness.end_user.id,
                ),
            ]
        )

    commits: list[Session] = []

    def record_commit(session: Session) -> None:
        commits.append(session)

    event.listen(Session, "before_commit", record_commit)
    try:
        response = _get(harness)
    finally:
        event.remove(Session, "before_commit", record_commit)
    assert response.status_code == HTTPStatus.OK
    assert not commits
    assert sorted(requests) == [("HEAD", "/assistant-image.png", False), ("HEAD", "/user-image.png", False)]
    assert response.headers["Content-Type"] == "application/json"
    body = response.get_json()
    assert body["limit"] == 20
    assert body["has_more"] is False
    [item] = body["data"]
    assert set(item) == {
        "id",
        "conversation_id",
        "parent_message_id",
        "inputs",
        "query",
        "answer",
        "feedback",
        "retriever_resources",
        "created_at",
        "agent_thoughts",
        "message_files",
        "message_tokens",
        "answer_tokens",
        "provider_response_latency",
        "total_price",
        "currency",
        "status",
        "error",
        "extra_contents",
        "total_tokens",
        "metadata",
    }
    assert item["id"] == harness.message.id
    assert item["conversation_id"] == harness.message.conversation_id
    assert item["parent_message_id"] is None
    assert item["inputs"] == {"text": "hello", "nested": {"value": [1, None]}}
    assert item["query"] == "question"
    assert item["answer"] == "answer"
    assert item["feedback"] == {"rating": "like"}
    assert item["metadata"] == metadata
    assert item["retriever_resources"][0]["id"] == resource_id
    assert item["created_at"] == int(created_at.timestamp())
    assert item["message_tokens"] == 3
    assert item["answer_tokens"] == 5
    assert item["total_tokens"] == 8
    assert Decimal(item["total_price"]) == Decimal("0.0012")
    assert item["provider_response_latency"] == 0.25
    assert item["currency"] == "USD"
    assert item["status"] == "normal"
    assert item["error"] is None
    assert item["extra_contents"] == []
    [actual_thought] = item["agent_thoughts"]
    assert actual_thought["id"] == thought.id
    assert actual_thought["chain_id"] == thought.message_chain_id
    assert actual_thought["tool_labels"] == {"search": "Search"}
    assert actual_thought["files"] == ["file-a"]
    assert actual_thought["created_at"] == int(created_at.timestamp())
    assert len(item["message_files"]) == 2
    actual_files = {file["id"]: file for file in item["message_files"]}
    for expected in (attachment, assistant_attachment):
        actual_file = actual_files[expected.id]
        assert expected.belongs_to is not None
        assert actual_file["url"] == expected.url
        assert actual_file["transfer_method"] == "remote_url"
        assert actual_file["type"] == "image"
        assert actual_file["belongs_to"] == expected.belongs_to.value
        assert actual_file["filename"] == "downloaded image.png"
        assert actual_file["mime_type"] == "image/png"
        assert actual_file["size"] == 42
    harness.assert_closed()


def test_pagination_returns_latest_slice_in_ascending_order(harness: _Harness) -> None:
    created_at = datetime(2024, 1, 1)
    messages = [
        make_message(
            message_id=str(uuid4()),
            app_id=harness.target.id,
            conversation_id=harness.message.conversation_id,
            inputs={},
            query=f"question-{index}",
            message={},
            answer=f"answer-{index}",
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.API,
            from_end_user_id=harness.end_user.id,
            created_at=created_at + timedelta(seconds=index),
        )
        for index in (1, 2)
    ]
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values(created_at=created_at))
        session.add_all(messages)
    response = _get(harness, limit=2)
    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    assert body["limit"] == 2
    assert body["has_more"] is True
    assert [item["id"] for item in body["data"]] == [message.id for message in messages]
    previous = _get(harness, first_id=messages[0].id, limit=2).get_json()
    assert previous["has_more"] is False
    assert [item["id"] for item in previous["data"]] == [harness.message.id]
    assert _get(harness, first_id=harness.message.id, limit=2).get_json() == {"limit": 2, "has_more": False, "data": []}
    harness.assert_closed()


def test_empty_conversation_keeps_pagination_shape(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Message).where(Message.id == harness.message.id))
    assert _get(harness, limit=100).get_json() == {"limit": 100, "has_more": False, "data": []}
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_account_id", "from_source"])
def test_conversation_ownership_is_enforced(harness: _Harness, field: str) -> None:
    value = ConversationFromSource.CONSOLE if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(
            update(Conversation).where(Conversation.id == harness.message.conversation_id).values({field: value})
        )
    response = _get(harness)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    assert response.get_json()["message"] == "Conversation Not Exists."
    harness.assert_closed()


@pytest.mark.parametrize("query", [{"conversation_id": str(uuid4())}, {"first_id": str(uuid4())}])
def test_missing_conversation_or_cursor_has_precise_error(harness: _Harness, query: dict[str, str]) -> None:
    response = _get(harness, **query)
    assert response.status_code == HTTPStatus.NOT_FOUND
    expected = "Conversation Not Exists." if "conversation_id" in query else "First Message Not Exists."
    assert response.get_json()["message"] == expected
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_app_is_rejected(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = _get(harness)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    harness.assert_closed()


@pytest.mark.parametrize("query", [{"limit": 0}, {"limit": 101}, {"conversation_id": "bad"}, {"first_id": "bad"}])
def test_invalid_query_is_rejected(harness: _Harness, query: dict[str, object]) -> None:
    response = _get(harness, **query)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    harness.assert_closed()


def test_corrupt_end_user_scope_is_rejected(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.end_user.id).values(app_id=str(uuid4())))
    response = _get(harness)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == "End user not found"
    harness.assert_closed()


def test_missing_passport_is_rejected(harness: _Harness) -> None:
    response = harness.app.test_client().get(
        "/messages", query_string={"conversation_id": harness.message.conversation_id}
    )
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
