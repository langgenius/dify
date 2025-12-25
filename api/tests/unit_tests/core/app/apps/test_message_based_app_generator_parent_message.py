from types import SimpleNamespace
from unittest.mock import patch

import pytest

from constants import UUID_NIL
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError


def test_validate_parent_message_service_api_skips_missing():
    generator = MessageBasedAppGenerator()

    with patch("core.app.apps.message_based_app_generator.MessageService.get_message") as get_message:
        generator._validate_parent_message_for_service_api(
            app_model=object(),
            user=object(),
            conversation=None,
            parent_message_id=None,
            invoke_from=InvokeFrom.SERVICE_API,
        )

        get_message.assert_not_called()


def test_validate_parent_message_service_api_skips_uuid_nil():
    generator = MessageBasedAppGenerator()

    with patch("core.app.apps.message_based_app_generator.MessageService.get_message") as get_message:
        generator._validate_parent_message_for_service_api(
            app_model=object(),
            user=object(),
            conversation=None,
            parent_message_id=UUID_NIL,
            invoke_from=InvokeFrom.SERVICE_API,
        )

        get_message.assert_not_called()


def test_validate_parent_message_service_api_requires_conversation():
    generator = MessageBasedAppGenerator()

    with pytest.raises(ConversationNotExistsError):
        generator._validate_parent_message_for_service_api(
            app_model=object(),
            user=object(),
            conversation=None,
            parent_message_id="parent-id",
            invoke_from=InvokeFrom.SERVICE_API,
        )


def test_validate_parent_message_service_api_mismatch_conversation():
    generator = MessageBasedAppGenerator()
    conversation = SimpleNamespace(id="conversation-id")
    parent_message = SimpleNamespace(conversation_id="different-id")

    with patch(
        "core.app.apps.message_based_app_generator.MessageService.get_message",
        return_value=parent_message,
    ):
        with pytest.raises(MessageNotExistsError):
            generator._validate_parent_message_for_service_api(
                app_model=object(),
                user=object(),
                conversation=conversation,
                parent_message_id="parent-id",
                invoke_from=InvokeFrom.SERVICE_API,
            )


def test_validate_parent_message_service_api_matches_conversation():
    generator = MessageBasedAppGenerator()
    conversation = SimpleNamespace(id="conversation-id")
    parent_message = SimpleNamespace(conversation_id="conversation-id")

    with patch(
        "core.app.apps.message_based_app_generator.MessageService.get_message",
        return_value=parent_message,
    ):
        generator._validate_parent_message_for_service_api(
            app_model=object(),
            user=object(),
            conversation=conversation,
            parent_message_id="parent-id",
            invoke_from=InvokeFrom.SERVICE_API,
        )
