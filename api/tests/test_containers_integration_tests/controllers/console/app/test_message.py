"""Authenticated controller integration tests for console message APIs."""

from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from controllers.console.app.message import ChatMessagesQuery, FeedbackExportQuery, MessageFeedbackPayload
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from libs.datetime_utils import naive_utc_now
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import AppMode, Conversation, Message, MessageAnnotation, MessageFeedback
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from tests.test_containers_integration_tests.controllers.console.helpers import (
    AuthenticatedConsoleAgentClient,
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


def _create_conversation(db_session: Session, app_id: str, account_id: str, mode: AppMode) -> Conversation:
    conversation = Conversation(
        app_id=app_id,
        app_model_config_id=None,
        model_provider=None,
        model_id="",
        override_model_configs=None,
        mode=mode,
        name="Test Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account_id,
    )
    db_session.add(conversation)
    db_session.commit()
    return conversation


def _create_message(
    db_session: Session,
    app_id: str,
    conversation_id: str,
    account_id: str,
    *,
    created_at_offset_seconds: int = 0,
    app_mode: AppMode = AppMode.CHAT,
    query: str = "Hello",
    answer: str = "Hi there",
) -> Message:
    created_at = naive_utc_now() + timedelta(seconds=created_at_offset_seconds)
    message = Message(
        app_id=app_id,
        model_provider=None,
        model_id="",
        override_model_configs=None,
        conversation_id=conversation_id,
        inputs={},
        query=query,
        message={"type": "text", "content": query},
        message_tokens=1,
        message_unit_price=Decimal("0.0001"),
        message_price_unit=Decimal("0.001"),
        answer=answer,
        answer_tokens=1,
        answer_unit_price=Decimal("0.0001"),
        answer_price_unit=Decimal("0.001"),
        parent_message_id=None,
        provider_response_latency=0,
        total_price=Decimal("0.0002"),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account_id,
        created_at=created_at,
        updated_at=created_at,
        app_mode=app_mode,
    )
    db_session.add(message)
    db_session.commit()
    return message


def _expected_message_contract(message: Message) -> dict[str, object]:
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "inputs": {},
        "query": message.query,
        "message": {"type": "text", "content": message.query},
        "message_tokens": 1,
        "answer": message.answer,
        "answer_tokens": 1,
        "provider_response_latency": 0.0,
        "from_source": ConversationFromSource.CONSOLE.value,
        "from_end_user_id": None,
        "from_account_id": message.from_account_id,
        "feedbacks": [],
        "workflow_run_id": None,
        "annotation": None,
        "annotation_hit_history": None,
        "created_at": int(message.created_at.timestamp()),
        "agent_thoughts": [],
        "message_files": [],
        "metadata": {},
        "status": "normal",
        "error": None,
        "parent_message_id": None,
        "extra_contents": [],
    }


class TestMessageValidators:
    def test_chat_messages_query_validators(self) -> None:
        assert ChatMessagesQuery.empty_to_none("") is None
        assert ChatMessagesQuery.empty_to_none("val") == "val"
        assert ChatMessagesQuery.validate_uuid(None) is None
        assert (
            ChatMessagesQuery.validate_uuid("123e4567-e89b-12d3-a456-426614174000")
            == "123e4567-e89b-12d3-a456-426614174000"
        )

    def test_message_feedback_validators(self) -> None:
        assert (
            MessageFeedbackPayload.validate_message_id("123e4567-e89b-12d3-a456-426614174000")
            == "123e4567-e89b-12d3-a456-426614174000"
        )

    def test_feedback_export_validators(self) -> None:
        assert FeedbackExportQuery.parse_bool(None) is None
        assert FeedbackExportQuery.parse_bool(True) is True
        assert FeedbackExportQuery.parse_bool("1") is True
        assert FeedbackExportQuery.parse_bool("0") is False
        assert FeedbackExportQuery.parse_bool("off") is False

        with pytest.raises(ValueError):
            FeedbackExportQuery.parse_bool("invalid")


def test_chat_message_list_not_found(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)

    response = container_client.get(
        f"/console/api/apps/{app.id}/chat-messages",
        query_string={"conversation_id": str(uuid4())},
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "not_found"


def test_chat_message_list_success(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(container_transaction, app.id, account.id, app.mode)
    first = _create_message(
        container_transaction,
        app.id,
        conversation.id,
        account.id,
        created_at_offset_seconds=0,
        query="First question",
        answer="First answer",
    )
    second = _create_message(
        container_transaction,
        app.id,
        conversation.id,
        account.id,
        created_at_offset_seconds=1,
        query="Second question",
        answer="Second answer",
    )
    # Capture IDs before the HTTP request detaches ORM instances from the session
    app_id = app.id
    conversation_id = conversation.id
    second_id = second.id

    response = container_client.get(
        f"/console/api/apps/{app_id}/chat-messages",
        query_string={"conversation_id": conversation_id, "limit": 1},
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["limit"] == 1
    assert payload["has_more"] is True
    assert payload["data"] == [_expected_message_contract(second)]

    cursor_response = container_client.get(
        f"/console/api/apps/{app_id}/chat-messages",
        query_string={"conversation_id": conversation_id, "first_id": second_id},
        headers=authenticate_console_client(container_client, account),
    )

    assert cursor_response.status_code == 200
    assert cursor_response.json is not None
    assert cursor_response.json["data"] == [_expected_message_contract(first)]
    assert cursor_response.json["limit"] == 20
    assert cursor_response.json["has_more"] is False


def test_message_feedback_not_found(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)

    response = container_client.post(
        f"/console/api/apps/{app.id}/feedbacks",
        json={"message_id": str(uuid4()), "rating": "like"},
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "not_found"


def test_message_feedback_success(
    container_transaction: Session,
    container_client: FlaskClient,
    container_state: DatabaseState,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(container_transaction, app.id, account.id, app.mode)
    message = _create_message(container_transaction, app.id, conversation.id, account.id)
    app_id = app.id
    account_id = account.id
    message_id = message.id

    response = container_client.post(
        f"/console/api/apps/{app_id}/feedbacks",
        json={"message_id": message_id, "rating": "like"},
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}

    feedback = container_state.one(MessageFeedback, MessageFeedback.message_id == message_id)
    assert feedback.rating == FeedbackRating.LIKE
    assert feedback.from_account_id == account_id

    update_response = container_client.post(
        f"/console/api/apps/{app_id}/feedbacks",
        json={"message_id": message_id, "rating": "dislike", "content": "Changed my mind"},
        headers=authenticate_console_client(container_client, account),
    )

    assert update_response.status_code == 200
    feedback = container_state.one(MessageFeedback, MessageFeedback.message_id == message_id)
    assert feedback.rating == FeedbackRating.DISLIKE
    assert feedback.content == "Changed my mind"

    delete_response = container_client.post(
        f"/console/api/apps/{app_id}/feedbacks",
        json={"message_id": message_id, "rating": None},
        headers=authenticate_console_client(container_client, account),
    )

    assert delete_response.status_code == 200
    assert container_state.count(MessageFeedback, MessageFeedback.message_id == message_id) == 0


def test_message_annotation_count(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(container_transaction, app.id, account.id, app.mode)
    message = _create_message(container_transaction, app.id, conversation.id, account.id)
    container_transaction.add(
        MessageAnnotation(
            app_id=app.id,
            conversation_id=conversation.id,
            message_id=message.id,
            question="Q",
            content="A",
            account_id=account.id,
        )
    )
    container_transaction.commit()

    response = container_client.get(
        f"/console/api/apps/{app.id}/annotations/count",
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"count": 1}


def test_message_suggested_questions_success(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(container_transaction, app.id, account.id, app.mode)
    message = _create_message(container_transaction, app.id, conversation.id, account.id)

    with patch(
        "controllers.console.app.message.MessageService.get_suggested_questions_after_answer",
        return_value=["q1", "q2"],
    ) as get_questions:
        response = container_client.get(
            f"/console/api/apps/{app.id}/chat-messages/{message.id}/suggested-questions",
            headers=authenticate_console_client(container_client, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"data": ["q1", "q2"]}
    call = get_questions.call_args.kwargs
    assert call["app_model"].id == app.id
    assert call["message_id"] == message.id
    assert call["user"].id == account.id


@pytest.mark.parametrize(
    ("exc", "expected_status", "expected_code"),
    [
        (MessageNotExistsError(), 404, "not_found"),
        (ConversationNotExistsError(), 404, "not_found"),
        (ProviderTokenNotInitError(), 400, "provider_not_initialize"),
        (QuotaExceededError(), 400, "provider_quota_exceeded"),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support"),
        (SuggestedQuestionsAfterAnswerDisabledError(), 403, "app_suggested_questions_after_answer_disabled"),
        (Exception(), 500, "internal_server_error"),
    ],
)
def test_message_suggested_questions_errors(
    exc: Exception,
    expected_status: int,
    expected_code: str,
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    message_id = str(uuid4())

    with patch(
        "controllers.console.app.message.MessageService.get_suggested_questions_after_answer",
        side_effect=exc,
    ):
        response = container_client.get(
            f"/console/api/apps/{app.id}/chat-messages/{message_id}/suggested-questions",
            headers=authenticate_console_client(container_client, account),
        )

    assert response.status_code == expected_status
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == expected_code


def test_message_feedback_export_success(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(container_transaction, app.id, account.id, app.mode)
    message = _create_message(container_transaction, app.id, conversation.id, account.id)
    headers = authenticate_console_client(container_client, account)
    feedback = MessageFeedback(
        app_id=app.id,
        conversation_id=conversation.id,
        message_id=message.id,
        rating=FeedbackRating.LIKE,
        content="Useful answer",
        from_source=FeedbackFromSource.ADMIN,
        from_account_id=account.id,
    )
    container_transaction.add(feedback)
    container_transaction.commit()

    response = container_client.get(
        f"/console/api/apps/{app.id}/feedbacks/export",
        query_string={"format": "json", "rating": "like", "has_comment": "true"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json is not None
    payload = response.json
    export_date = payload["export_info"].pop("export_date")
    datetime.fromisoformat(export_date)
    assert payload == {
        "export_info": {
            "app_id": app.id,
            "total_records": 1,
            "data_source": "dify_feedback_export",
        },
        "feedback_data": [
            {
                "feedback_id": feedback.id,
                "app_name": app.name,
                "app_id": app.id,
                "conversation_id": conversation.id,
                "conversation_name": conversation.name,
                "message_id": message.id,
                "user_query": message.query,
                "ai_response": message.answer,
                "feedback_rating": "\U0001f44d",
                "feedback_rating_raw": FeedbackRating.LIKE.value,
                "feedback_comment": "Useful answer",
                "feedback_source": FeedbackFromSource.ADMIN.value,
                "feedback_date": feedback.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                "message_date": message.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                "from_account_name": account.name,
                "from_end_user_id": "",
                "has_comment": "Yes",
            }
        ],
    }

    invalid_response = container_client.get(
        f"/console/api/apps/{app.id}/feedbacks/export",
        query_string={"format": "json", "start_date": "not-a-date"},
        headers=headers,
    )

    assert invalid_response.status_code == 400
    assert invalid_response.json is not None
    assert "Invalid start_date format" in invalid_response.json["error"]


def test_message_api_get_success(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(container_transaction, app.id, account.id, app.mode)
    message = _create_message(container_transaction, app.id, conversation.id, account.id)

    response = container_client.get(
        f"/console/api/apps/{app.id}/messages/{message.id}",
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload == _expected_message_contract(message)


def test_agent_message_routes_use_backing_app_and_persist_feedback(
    container_transaction: Session,
    authenticated_console_agent_client: AuthenticatedConsoleAgentClient,
    container_state: DatabaseState,
) -> None:
    context = authenticated_console_agent_client
    conversation = _create_conversation(
        container_transaction,
        context.app.id,
        context.account.id,
        AppMode.AGENT,
    )
    message = _create_message(
        container_transaction,
        context.app.id,
        conversation.id,
        context.account.id,
        app_mode=AppMode.AGENT,
    )
    agent_id = context.agent.id
    conversation_id = conversation.id
    message_id = message.id
    route_prefix = f"/console/api/agent/{agent_id}"

    list_response = context.client.get(
        f"{route_prefix}/chat-messages",
        query_string={"conversation_id": conversation_id},
        headers=context.headers,
    )
    detail_response = context.client.get(
        f"{route_prefix}/messages/{message_id}",
        headers=context.headers,
    )
    feedback_response = context.client.post(
        f"{route_prefix}/feedbacks",
        json={"message_id": message_id, "rating": "dislike", "content": "Needs work"},
        headers=context.headers,
    )
    with patch(
        "controllers.console.app.message.MessageService.get_suggested_questions_after_answer",
        return_value=["What changed?"],
    ):
        questions_response = context.client.get(
            f"{route_prefix}/chat-messages/{message_id}/suggested-questions",
            headers=context.headers,
        )

    assert list_response.status_code == 200
    assert list_response.json is not None
    assert list_response.json["data"] == [_expected_message_contract(message)]
    assert detail_response.status_code == 200
    assert detail_response.json is not None
    assert detail_response.json == _expected_message_contract(message)
    assert feedback_response.status_code == 200
    assert feedback_response.json == {"result": "success"}
    feedback = container_state.one(MessageFeedback, MessageFeedback.message_id == message_id)
    assert feedback.app_id == context.app.id
    assert feedback.rating == FeedbackRating.DISLIKE
    assert feedback.content == "Needs work"
    assert feedback.from_account_id == context.account.id
    assert questions_response.status_code == 200
    assert questions_response.json == {"data": ["What changed?"]}
