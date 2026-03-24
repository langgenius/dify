"""Authenticated controller integration tests for console message APIs."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console.app.message import ChatMessagesQuery, FeedbackExportQuery, MessageFeedbackPayload
from controllers.console.app.message import attach_message_extra_contents as _attach_message_extra_contents
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from libs.datetime_utils import naive_utc_now
from models.enums import ConversationFromSource, FeedbackRating
from models.model import AppMode, Conversation, Message, MessageAnnotation, MessageFeedback
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


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
) -> Message:
    created_at = naive_utc_now() + timedelta(seconds=created_at_offset_seconds)
    message = Message(
        app_id=app_id,
        model_provider=None,
        model_id="",
        override_model_configs=None,
        conversation_id=conversation_id,
        inputs={},
        query="Hello",
        message={"type": "text", "content": "Hello"},
        message_tokens=1,
        message_unit_price=Decimal("0.0001"),
        message_price_unit=Decimal("0.001"),
        answer="Hi there",
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
        app_mode=AppMode.CHAT,
    )
    db_session.add(message)
    db_session.commit()
    return message


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
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/chat-messages",
        query_string={"conversation_id": str(uuid4())},
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "not_found"


def test_chat_message_list_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, app.mode)
    _create_message(db_session_with_containers, app.id, conversation.id, account.id, created_at_offset_seconds=0)
    second = _create_message(
        db_session_with_containers,
        app.id,
        conversation.id,
        account.id,
        created_at_offset_seconds=1,
    )

    with patch(
        "controllers.console.app.message.attach_message_extra_contents",
        side_effect=_attach_message_extra_contents,
    ):
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/chat-messages",
            query_string={"conversation_id": conversation.id, "limit": 1},
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["limit"] == 1
    assert payload["has_more"] is True
    assert len(payload["data"]) == 1
    assert payload["data"][0]["id"] == second.id


def test_message_feedback_not_found(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)

    response = test_client_with_containers.post(
        f"/console/api/apps/{app.id}/feedbacks",
        json={"message_id": str(uuid4()), "rating": "like"},
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "not_found"


def test_message_feedback_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, app.mode)
    message = _create_message(db_session_with_containers, app.id, conversation.id, account.id)

    response = test_client_with_containers.post(
        f"/console/api/apps/{app.id}/feedbacks",
        json={"message_id": message.id, "rating": "like"},
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}

    feedback = db_session_with_containers.scalar(
        select(MessageFeedback).where(MessageFeedback.message_id == message.id)
    )
    assert feedback is not None
    assert feedback.rating == FeedbackRating.LIKE
    assert feedback.from_account_id == account.id


def test_message_annotation_count(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, app.mode)
    message = _create_message(db_session_with_containers, app.id, conversation.id, account.id)
    db_session_with_containers.add(
        MessageAnnotation(
            app_id=app.id,
            conversation_id=conversation.id,
            message_id=message.id,
            question="Q",
            content="A",
            account_id=account.id,
        )
    )
    db_session_with_containers.commit()

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/annotations/count",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"count": 1}


def test_message_suggested_questions_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    message_id = str(uuid4())

    with patch(
        "controllers.console.app.message.MessageService.get_suggested_questions_after_answer",
        return_value=["q1", "q2"],
    ):
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/chat-messages/{message_id}/suggested-questions",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"data": ["q1", "q2"]}


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
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    message_id = str(uuid4())

    with patch(
        "controllers.console.app.message.MessageService.get_suggested_questions_after_answer",
        side_effect=exc,
    ):
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/chat-messages/{message_id}/suggested-questions",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == expected_status
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == expected_code


def test_message_feedback_export_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)

    with patch("services.feedback_service.FeedbackService.export_feedbacks", return_value={"exported": True}):
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/feedbacks/export",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"exported": True}


def test_message_api_get_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, app.mode)
    message = _create_message(db_session_with_containers, app.id, conversation.id, account.id)

    with patch(
        "controllers.console.app.message.attach_message_extra_contents",
        side_effect=_attach_message_extra_contents,
    ):
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/messages/{message.id}",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["id"] == message.id
