"""
Unit tests for services.advanced_prompt_template_service
"""

import copy

from core.prompt.prompt_templates.advanced_prompt_templates import (
    BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG,
    BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG,
    BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG,
    BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
    BAICHUAN_CONTEXT,
    CHAT_APP_CHAT_PROMPT_CONFIG,
    CHAT_APP_COMPLETION_PROMPT_CONFIG,
    COMPLETION_APP_CHAT_PROMPT_CONFIG,
    COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
    CONTEXT,
)
from models.model import AppMode
from services.advanced_prompt_template_service import AdvancedPromptTemplateService


class TestAdvancedPromptTemplateService:
    """Test suite for AdvancedPromptTemplateService."""

    def test_get_prompt_should_use_baichuan_prompt_when_model_name_contains_baichuan(self) -> None:
        """Test baichuan model names use baichuan context prompt."""
        # Arrange
        args = {
            "app_mode": AppMode.CHAT,
            "model_mode": "chat",
            "model_name": "Baichuan2-13B",
            "has_context": "true",
        }

        # Act
        result = AdvancedPromptTemplateService.get_prompt(args)

        # Assert
        assert result["chat_prompt_config"]["prompt"][0]["text"].startswith(BAICHUAN_CONTEXT)

    def test_get_prompt_should_use_common_prompt_when_model_name_not_baichuan(self) -> None:
        """Test non-baichuan model names use common prompt."""
        # Arrange
        args = {
            "app_mode": AppMode.CHAT,
            "model_mode": "completion",
            "model_name": "gpt-4",
            "has_context": "false",
        }
        original_config = copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_prompt(args)

        # Assert
        assert result == original_config
        assert original_config == CHAT_APP_COMPLETION_PROMPT_CONFIG

    def test_get_common_prompt_should_return_empty_dict_when_app_mode_invalid(self) -> None:
        """Test invalid app mode returns empty dict."""
        # Arrange
        app_mode = "invalid"
        model_mode = "chat"

        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(app_mode, model_mode, "true")

        # Assert
        assert result == {}

    def test_get_common_prompt_should_prepend_context_for_completion_prompt(self) -> None:
        """Test context is prepended for completion prompt when has_context is true."""
        # Arrange
        original_config = copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "completion", "true")

        # Assert
        assert result["completion_prompt_config"]["prompt"]["text"].startswith(CONTEXT)
        assert original_config == CHAT_APP_COMPLETION_PROMPT_CONFIG

    def test_get_common_prompt_should_prepend_context_for_chat_prompt(self) -> None:
        """Test context is prepended for chat prompt when has_context is true."""
        # Arrange
        original_config = copy.deepcopy(COMPLETION_APP_CHAT_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.COMPLETION, "chat", "true")

        # Assert
        assert result["chat_prompt_config"]["prompt"][0]["text"].startswith(CONTEXT)
        assert original_config == COMPLETION_APP_CHAT_PROMPT_CONFIG

    def test_get_common_prompt_should_return_chat_prompt_without_context_when_has_context_false(self) -> None:
        """Test chat prompt remains unchanged when has_context is false."""
        # Arrange
        original_config = copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "chat", "false")

        # Assert
        assert result == original_config
        assert original_config == CHAT_APP_CHAT_PROMPT_CONFIG

    def test_get_common_prompt_should_return_completion_prompt_for_completion_app_mode(self) -> None:
        """Test completion app mode with completion model returns completion prompt."""
        # Arrange
        original_config = copy.deepcopy(COMPLETION_APP_COMPLETION_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.COMPLETION, "completion", "false")

        # Assert
        assert result == original_config
        assert original_config == COMPLETION_APP_COMPLETION_PROMPT_CONFIG

    def test_get_common_prompt_should_return_empty_dict_when_model_mode_invalid(self) -> None:
        """Test invalid model mode returns empty dict."""
        # Arrange
        app_mode = AppMode.CHAT
        model_mode = "invalid"

        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(app_mode, model_mode, "false")

        # Assert
        assert result == {}

    def test_get_completion_prompt_should_not_prepend_context_when_has_context_false(self) -> None:
        """Test helper keeps completion prompt unchanged when context is disabled."""
        # Arrange
        prompt_template = copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG)
        original_text = prompt_template["completion_prompt_config"]["prompt"]["text"]

        # Act
        result = AdvancedPromptTemplateService.get_completion_prompt(prompt_template, "false", CONTEXT)

        # Assert
        assert result["completion_prompt_config"]["prompt"]["text"] == original_text

    def test_get_chat_prompt_should_not_prepend_context_when_has_context_false(self) -> None:
        """Test helper keeps chat prompt unchanged when context is disabled."""
        # Arrange
        prompt_template = copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG)
        original_text = prompt_template["chat_prompt_config"]["prompt"][0]["text"]

        # Act
        result = AdvancedPromptTemplateService.get_chat_prompt(prompt_template, "false", CONTEXT)

        # Assert
        assert result["chat_prompt_config"]["prompt"][0]["text"] == original_text

    def test_get_baichuan_prompt_should_return_chat_completion_config_when_chat_completion(self) -> None:
        """Test baichuan chat/completion returns the expected config."""
        # Arrange
        original_config = copy.deepcopy(BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "completion", "false")

        # Assert
        assert result == original_config
        assert original_config == BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG

    def test_get_baichuan_prompt_should_return_completion_chat_config_when_completion_chat(self) -> None:
        """Test baichuan completion/chat returns the expected config."""
        # Arrange
        original_config = copy.deepcopy(BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.COMPLETION, "chat", "false")

        # Assert
        assert result == original_config
        assert original_config == BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG

    def test_get_baichuan_prompt_should_return_completion_completion_config_when_enabled_context(self) -> None:
        """Test baichuan completion/completion prepends baichuan context when enabled."""
        # Arrange
        original_config = copy.deepcopy(BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.COMPLETION, "completion", "true")

        # Assert
        assert result["completion_prompt_config"]["prompt"]["text"].startswith(BAICHUAN_CONTEXT)
        assert original_config == BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG

    def test_get_baichuan_prompt_should_return_chat_chat_config_when_enabled_context(self) -> None:
        """Test baichuan chat/chat prepends baichuan context when enabled."""
        # Arrange
        original_config = copy.deepcopy(BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG)

        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "chat", "true")

        # Assert
        assert result["chat_prompt_config"]["prompt"][0]["text"].startswith(BAICHUAN_CONTEXT)
        assert original_config == BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG

    def test_get_baichuan_prompt_should_return_empty_dict_when_invalid_inputs(self) -> None:
        """Test invalid baichuan mode combinations return empty dict."""
        # Arrange
        app_mode = "invalid"
        model_mode = "invalid"

        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(app_mode, model_mode, "true")

        # Assert
        assert result == {}
