from types import SimpleNamespace
from unittest.mock import patch

import pytest
from werkzeug.exceptions import BadRequest, NotFound

from constants import UUID_NIL
from controllers.service_api.app.completion import _validate_parent_message_request
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError


def test_validate_parent_message_skips_when_missing():
    app_model = object()
    end_user = object()

    with (
        patch("controllers.service_api.app.completion.ConversationService.get_conversation") as get_conversation,
        patch("controllers.service_api.app.completion.MessageService.get_message") as get_message,
    ):
        _validate_parent_message_request(
            app_model=app_model, end_user=end_user, conversation_id=None, parent_message_id=None
        )

        get_conversation.assert_not_called()
        get_message.assert_not_called()


def test_validate_parent_message_skips_uuid_nil():
    app_model = object()
    end_user = object()

    with (
        patch("controllers.service_api.app.completion.ConversationService.get_conversation") as get_conversation,
        patch("controllers.service_api.app.completion.MessageService.get_message") as get_message,
    ):
        _validate_parent_message_request(
            app_model=app_model,
            end_user=end_user,
            conversation_id=None,
            parent_message_id=UUID_NIL,
        )

        get_conversation.assert_not_called()
        get_message.assert_not_called()


def test_validate_parent_message_requires_conversation_id():
    app_model = object()
    end_user = object()

    with pytest.raises(BadRequest):
        _validate_parent_message_request(
            app_model=app_model, end_user=end_user, conversation_id=None, parent_message_id="parent-id"
        )


def test_validate_parent_message_missing_conversation_raises_not_found():
    app_model = object()
    end_user = object()

    with patch(
        "controllers.service_api.app.completion.ConversationService.get_conversation",
        side_effect=ConversationNotExistsError(),
    ):
        with pytest.raises(NotFound):
            _validate_parent_message_request(
                app_model=app_model,
                end_user=end_user,
                conversation_id="conversation-id",
                parent_message_id="parent-id",
            )


def test_validate_parent_message_missing_message_raises_not_found():
    app_model = object()
    end_user = object()
    conversation = SimpleNamespace(id="conversation-id")

    with (
        patch("controllers.service_api.app.completion.ConversationService.get_conversation", return_value=conversation),
        patch(
            "controllers.service_api.app.completion.MessageService.get_message",
            side_effect=MessageNotExistsError(),
        ),
    ):
        with pytest.raises(NotFound):
            _validate_parent_message_request(
                app_model=app_model,
                end_user=end_user,
                conversation_id="conversation-id",
                parent_message_id="parent-id",
            )


def test_validate_parent_message_mismatch_conversation_raises_bad_request():
    app_model = object()
    end_user = object()
    conversation = SimpleNamespace(id="conversation-id")
    message = SimpleNamespace(conversation_id="different-id")

    with (
        patch("controllers.service_api.app.completion.ConversationService.get_conversation", return_value=conversation),
        patch("controllers.service_api.app.completion.MessageService.get_message", return_value=message),
    ):
        with pytest.raises(BadRequest):
            _validate_parent_message_request(
                app_model=app_model,
                end_user=end_user,
                conversation_id="conversation-id",
                parent_message_id="parent-id",
            )


def test_validate_parent_message_matches_conversation():
    app_model = object()
    end_user = object()
    conversation = SimpleNamespace(id="conversation-id")
    message = SimpleNamespace(conversation_id="conversation-id")

    with (
        patch("controllers.service_api.app.completion.ConversationService.get_conversation", return_value=conversation),
        patch("controllers.service_api.app.completion.MessageService.get_message", return_value=message),
    ):
        _validate_parent_message_request(
            app_model=app_model,
            end_user=end_user,
            conversation_id="conversation-id",
            parent_message_id="parent-id",
        )
