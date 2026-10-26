from types import SimpleNamespace
from unittest.mock import Mock, patch

from core.app.features.hosting_moderation.hosting_moderation import (
    HostingModerationFeature,
)


class TestHostingModerationFeature:
    def test_check_aggregates_text_and_calls_moderation(self) -> None:
        application_generate_entity = Mock()
        application_generate_entity.model_conf = {"model": "mock"}
        application_generate_entity.app_config = SimpleNamespace(tenant_id="tenant-1")

        # Stand-ins rather than real PromptMessage instances: `content` is
        # deliberately not always a string so the skip branch gets exercised.
        prompt_messages = [
            Mock(content="hello"),
            Mock(content=123),
            Mock(content="world"),
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
