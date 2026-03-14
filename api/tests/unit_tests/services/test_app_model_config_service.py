from unittest.mock import patch

import pytest

from models.model import AppMode
from services.app_model_config_service import AppModelConfigService


@pytest.fixture
def mock_config_managers():
    """Fixture that patches all app config manager validate methods.

    Returns a dictionary containing the mocked config_validate methods for each manager.
    """
    with (
        patch("services.app_model_config_service.ChatAppConfigManager.config_validate") as mock_chat_validate,
        patch("services.app_model_config_service.AgentChatAppConfigManager.config_validate") as mock_agent_validate,
        patch(
            "services.app_model_config_service.CompletionAppConfigManager.config_validate"
        ) as mock_completion_validate,
    ):
        mock_chat_validate.return_value = {"manager": "chat"}
        mock_agent_validate.return_value = {"manager": "agent"}
        mock_completion_validate.return_value = {"manager": "completion"}

        yield {
            "chat": mock_chat_validate,
            "agent": mock_agent_validate,
            "completion": mock_completion_validate,
        }


class TestAppModelConfigService:
    @pytest.mark.parametrize(
        ("app_mode", "selected_manager"),
        [
            (AppMode.CHAT, "chat"),
            (AppMode.AGENT_CHAT, "agent"),
            (AppMode.COMPLETION, "completion"),
        ],
    )
    def test_should_route_validation_to_correct_manager_based_on_app_mode(
        self, app_mode, selected_manager, mock_config_managers
    ):
        """Test configuration validation is delegated to the expected manager for each supported app mode."""
        tenant_id = "tenant-123"
        config = {"temperature": 0.5}

        mock_chat_validate = mock_config_managers["chat"]
        mock_agent_validate = mock_config_managers["agent"]
        mock_completion_validate = mock_config_managers["completion"]

        result = AppModelConfigService.validate_configuration(tenant_id=tenant_id, config=config, app_mode=app_mode)

        assert result == {"manager": selected_manager}

        if selected_manager == "chat":
            mock_chat_validate.assert_called_once_with(tenant_id, config)
            mock_agent_validate.assert_not_called()
            mock_completion_validate.assert_not_called()
        elif selected_manager == "agent":
            mock_agent_validate.assert_called_once_with(tenant_id, config)
            mock_chat_validate.assert_not_called()
            mock_completion_validate.assert_not_called()
        else:
            mock_completion_validate.assert_called_once_with(tenant_id, config)
            mock_chat_validate.assert_not_called()
            mock_agent_validate.assert_not_called()

    def test_should_raise_value_error_when_app_mode_is_not_supported(self, mock_config_managers):
        """Test unsupported app modes raise ValueError with the invalid mode in the message."""
        tenant_id = "tenant-123"
        config = {"temperature": 0.5}

        mock_chat_validate = mock_config_managers["chat"]
        mock_agent_validate = mock_config_managers["agent"]
        mock_completion_validate = mock_config_managers["completion"]

        with pytest.raises(ValueError, match=f"Invalid app mode: {AppMode.WORKFLOW}"):
            AppModelConfigService.validate_configuration(
                tenant_id=tenant_id,
                config=config,
                app_mode=AppMode.WORKFLOW,
            )

        mock_chat_validate.assert_not_called()
        mock_agent_validate.assert_not_called()
        mock_completion_validate.assert_not_called()
