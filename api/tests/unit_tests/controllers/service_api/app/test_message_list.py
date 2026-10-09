"""Service API history through real API token admission and detached SQLite reads."""

import json
from datetime import datetime, timedelta
from decimal import Decimal
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, update
from werkzeug.test import TestResponse

from models.account import Tenant, TenantStatus
from models.enums import DEFAULT_END_USER_SESSION_ID, ConversationFromSource
from models.model import App, AppMode, Conversation, EndUser, Message
from tests.unit_tests.controllers.service_api.app.test_message_feedback import _Harness
from tests.unit_tests.controllers.service_api.app.test_message_feedback import harness as admission_harness
from tests.unit_tests.model_factories import make_conversation, make_message

harness = admission_harness


def _get(
    harness: _Harness,
    *,
    user: str | None = "alice",
    authorization: str | None = "Bearer feedback-test-token",
    **query: object,
) -> TestResponse:
    query_string = {"conversation_id": harness.message.conversation_id, **query}
    if user is not None:
        query_string["user"] = user
    headers: dict[str, str] = {"Authorization": authorization} if authorization is not None else {}
    return harness.app.test_client().get("/messages", query_string=query_string, headers=headers)


def test_history_shape_omits_web_metadata_and_preserves_nulls(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(Message)
            .where(Message.id == harness.message.id)
            .values(
                created_at=datetime(2024, 1, 1, 12),
                message_metadata=json.dumps({"private": "web-only", "retriever_resources": []}),
                message_tokens=3,
                answer_tokens=5,
                total_price=Decimal("0.0012"),
                provider_response_latency=0.25,
            )
        )
    response = _get(harness)
    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    body = response.get_json()
    assert body["limit"] == 20
    assert body["has_more"] is False
    [item] = body["data"]
    assert item == {
        "id": harness.message.id,
        "conversation_id": harness.message.conversation_id,
        "parent_message_id": None,
        "inputs": {},
        "query": "question",
        "answer": "answer",
        "feedback": None,
        "retriever_resources": [],
        "created_at": int(datetime(2024, 1, 1, 12).timestamp()),
        "agent_thoughts": [],
        "message_files": [],
        "message_tokens": 3,
        "answer_tokens": 5,
        "provider_response_latency": 0.25,
        "total_price": item["total_price"],
        "currency": "USD",
        "status": "normal",
        "error": None,
        "extra_contents": [],
        "total_tokens": 8,
    }
    assert isinstance(item["total_price"], str)
    assert Decimal(item["total_price"]) == Decimal("0.0012")
    harness.assert_closed()


def test_history_pages_are_ascending_and_cursor_excludes_equal_timestamps(harness: _Harness) -> None:
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
    with harness.factory.begin() as session:
        session.execute(
            update(Message).where(Message.id == harness.message.id).values(created_at=messages[0].created_at)
        )
    assert _get(harness, first_id=messages[0].id, limit=2).get_json() == {"limit": 2, "has_more": False, "data": []}
    harness.assert_closed()


def test_empty_conversation_keeps_pagination_shape(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Message).where(Message.id == harness.message.id))
    response = _get(harness, limit=100)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"limit": 100, "has_more": False, "data": []}
    harness.assert_closed()


@pytest.mark.parametrize("user", [None, ""])
def test_optional_user_is_provisioned_and_cannot_read_existing_users_history(
    harness: _Harness, user: str | None
) -> None:
    response = _get(harness, user=user)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == "Conversation Not Exists."
    with harness.factory() as session:
        users = session.scalars(select(EndUser).where(EndUser.app_id == harness.target.id)).all()
    anonymous = [end_user for end_user in users if end_user.id != harness.end_user.id]
    assert len(anonymous) == 1
    assert anonymous[0].session_id == DEFAULT_END_USER_SESSION_ID
    assert anonymous[0].external_user_id == DEFAULT_END_USER_SESSION_ID
    harness.assert_closed()


def test_other_end_user_cannot_read_history(harness: _Harness) -> None:
    response = _get(harness, user="other-user")
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == "Conversation Not Exists."
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


def test_cursor_from_another_conversation_is_rejected(harness: _Harness) -> None:
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=harness.target.id,
        inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=harness.end_user.id,
    )
    with harness.factory.begin() as session:
        session.add(conversation)
    response = _get(harness, conversation_id=conversation.id, first_id=harness.message.id)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == "First Message Not Exists."
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_app_is_rejected(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = _get(harness)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    harness.assert_closed()


@pytest.mark.parametrize("query", [{"limit": "0"}, {"limit": "101"}, {"conversation_id": "bad"}, {"first_id": "bad"}])
def test_invalid_query_is_rejected(harness: _Harness, query: dict[str, str]) -> None:
    response = _get(harness, **query)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    harness.assert_closed()


@pytest.mark.parametrize("authorization", [None, "Basic feedback-test-token"])
def test_invalid_authorization_is_rejected(harness: _Harness, authorization: str | None) -> None:
    response = _get(harness, authorization=authorization)
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert harness.sessions == []


def test_archived_workspace_is_rejected(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Tenant).where(Tenant.id == harness.tenant.id).values(status=TenantStatus.ARCHIVE))
    response = _get(harness)
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "workspace_archived"
    harness.assert_closed()
