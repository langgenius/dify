import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from core.app.features.hosting_moderation.hosting_moderation import (
    HostingModerationFeature,
)
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole, UserPromptMessage


class TestHostingModerationFeature:
    def test_check_aggregates_text_and_calls_moderation(self) -> None:
        application_generate_entity = Mock()
        application_generate_entity.model_conf = {"model": "mock"}
        application_generate_entity.app_config = SimpleNamespace(tenant_id="tenant-1")

        # The middle message bypasses validation on purpose: `content` is not
        # always a string at runtime, and the feature must skip those entries.
        # The JSON round-trip keeps the runtime int while satisfying the declared type.
        non_string_content = json.loads("123")
        prompt_messages: list[PromptMessage] = [
            UserPromptMessage(role=PromptMessageRole.USER, content="hello"),
            UserPromptMessage.model_construct(role=PromptMessageRole.USER, content=non_string_content),
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
