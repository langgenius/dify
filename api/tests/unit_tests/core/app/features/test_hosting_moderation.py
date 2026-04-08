from unittest.mock import Mock, patch

from graphon.model_runtime.entities.message_entities import PromptMessage

from core.app.features.hosting_moderation.hosting_moderation import HostingModerationFeature


class TestHostingModerationFeature:
    def test_check_aggregates_text_and_calls_moderation(self):
        application_generate_entity = Mock()
        application_generate_entity.model_conf = {"model": "mock"}
        application_generate_entity.app_config = Mock(tenant_id="tenant-1")

        non_string_content = Mock(spec=PromptMessage)
        non_string_content.content = 123

        prompt_messages: list[PromptMessage] = [
            Mock(spec=PromptMessage, content="hello"),
            non_string_content,
            Mock(spec=PromptMessage, content="world"),
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
