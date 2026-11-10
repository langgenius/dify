from types import SimpleNamespace
from unittest.mock import Mock, patch

from core.app.features.hosting_moderation.hosting_moderation import (
    HostingModerationFeature,
)
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole, UserPromptMessage


def _message_with_non_text_content() -> UserPromptMessage:
    """Build a user message whose content is not text.

    Preconditions: none.
    Postconditions: the returned message has integer content so moderation skips it.
    """

    message = UserPromptMessage(role=PromptMessageRole.USER, content=None)
    object.__setattr__(message, "content", 123)
    return message


class TestHostingModerationFeature:
    def test_check_aggregates_text_and_calls_moderation(self) -> None:
        application_generate_entity = Mock()
        application_generate_entity.model_conf = {"model": "mock"}
        application_generate_entity.app_config = SimpleNamespace(tenant_id="tenant-1")

        # The middle message bypasses validation on purpose: `content` is not
        # always a string at runtime, and the feature must skip those entries.
        prompt_messages: list[PromptMessage] = [
            UserPromptMessage(role=PromptMessageRole.USER, content="hello"),
            _message_with_non_text_content(),
            UserPromptMessage(role=PromptMessageRole.USER, content="world"),
        ]

        with patch("core.app.features.hosting_moderation.hosting_moderation.moderation.check_moderation") as mock_check:
            mock_check.return_value = True

            feature = HostingModerationFeature()
            result = feature.check(application_generate_entity, prompt_messages)

        assert result is True
        mock_check.assert_called_once_with(
            tenant_id="tenant-1",
            model_config=application_generate_entity.model_conf,
            text="hello\nworld\n",
        )
