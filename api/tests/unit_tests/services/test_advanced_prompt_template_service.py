import copy
from unittest.mock import patch

import pytest

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
from services.advanced_prompt_template_service import (
    AdvancedPromptTemplateArgs,
    AdvancedPromptTemplateService,
)

TEST_MODEL_BAICHUAN = "baichuan-7b-chat"
TEST_MODEL_NORMAL = "gpt-3.5-turbo"
TEST_HAS_CONTEXT_TRUE = "true"
TEST_HAS_CONTEXT_FALSE = "false"
TEST_INVALID_MODE = "invalid_mode"


class TestAdvancedPromptTemplateFactory:
    """Factory class for creating test arguments and mock data."""

    @staticmethod
    def create_prompt_args(
        app_mode: str = AppMode.CHAT,
        model_mode: str = "chat",
        model_name: str = TEST_MODEL_NORMAL,
        has_context: str = TEST_HAS_CONTEXT_TRUE,
    ) -> AdvancedPromptTemplateArgs:
        """Create a valid AdvancedPromptTemplateArgs dict."""
        return {
            "app_mode": app_mode,
            "model_mode": model_mode,
            "model_name": model_name,
            "has_context": has_context,
        }


class TestAdvancedPromptTemplateService:
    """
    Unit tests for AdvancedPromptTemplateService.

    This test suite covers:
    - Common model prompt generation (all app_mode + model_mode combinations)
    - Baichuan model prompt generation (all app_mode + model_mode combinations)
    - Context inclusion logic (true/false)
    - Invalid/unknown modes returning empty dict
    - Deep copy of prompt templates
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestAdvancedPromptTemplateFactory()

    def test_get_prompt_baichuan_model(self, factory):
        """Test get_prompt routes to Baichuan handler for Baichuan models."""
        # Arrange
        args = factory.create_prompt_args(model_name=TEST_MODEL_BAICHUAN)

        # Act
        with patch.object(AdvancedPromptTemplateService, "get_baichuan_prompt") as mock_baichuan:
            AdvancedPromptTemplateService.get_prompt(args)

        # Assert
        mock_baichuan.assert_called_once_with(args["app_mode"], args["model_mode"], args["has_context"])

    def test_get_prompt_common_model(self, factory):
        """Test get_prompt routes to common handler for non-Baichuan models."""
        # Arrange
        args = factory.create_prompt_args(model_name=TEST_MODEL_NORMAL)

        # Act
        with patch.object(AdvancedPromptTemplateService, "get_common_prompt") as mock_common:
            AdvancedPromptTemplateService.get_prompt(args)

        # Assert
        mock_common.assert_called_once_with(args["app_mode"], args["model_mode"], args["has_context"])

    def test_get_common_prompt_chat_app_completion_mode_with_context(self):
        """Test common prompt: CHAT app + completion mode with context."""
        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "completion", TEST_HAS_CONTEXT_TRUE)

        # Assert
        expected_template = copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG)
        expected_template["completion_prompt_config"]["prompt"]["text"] = (
            CONTEXT + expected_template["completion_prompt_config"]["prompt"]["text"]
        )
        assert result == expected_template

    def test_get_common_prompt_chat_app_chat_mode_without_context(self):
        """Test common prompt: CHAT app + chat mode without context."""
        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "chat", TEST_HAS_CONTEXT_FALSE)

        # Assert
        assert result == copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG)

    def test_get_common_prompt_completion_app_completion_mode(self):
        """Test common prompt: COMPLETION app + completion mode."""
        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(
            AppMode.COMPLETION, "completion", TEST_HAS_CONTEXT_TRUE
        )

        # Assert
        expected_template = copy.deepcopy(COMPLETION_APP_COMPLETION_PROMPT_CONFIG)
        expected_template["completion_prompt_config"]["prompt"]["text"] = (
            CONTEXT + expected_template["completion_prompt_config"]["prompt"]["text"]
        )
        assert result == expected_template

    def test_get_common_prompt_completion_app_chat_mode(self):
        """Test common prompt: COMPLETION app + chat mode."""
        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.COMPLETION, "chat", TEST_HAS_CONTEXT_FALSE)

        # Assert
        assert result == copy.deepcopy(COMPLETION_APP_CHAT_PROMPT_CONFIG)

    @pytest.mark.parametrize(
        ("app_mode", "model_mode"),
        [
            (AppMode.CHAT, TEST_INVALID_MODE),
            (AppMode.COMPLETION, TEST_INVALID_MODE),
            (TEST_INVALID_MODE, "chat"),
            (TEST_INVALID_MODE, "completion"),
        ],
    )
    def test_get_common_prompt_invalid_modes_return_empty(self, app_mode, model_mode):
        """Test common prompt returns empty dict for invalid app/model modes."""
        # Act
        result = AdvancedPromptTemplateService.get_common_prompt(app_mode, model_mode, TEST_HAS_CONTEXT_TRUE)

        # Assert
        assert result == {}

    def test_get_baichuan_prompt_chat_app_completion_mode_with_context(self):
        """Test Baichuan prompt: CHAT app + completion mode with context."""
        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "completion", TEST_HAS_CONTEXT_TRUE)

        # Assert
        expected_template = copy.deepcopy(BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG)
        expected_template["completion_prompt_config"]["prompt"]["text"] = (
            BAICHUAN_CONTEXT + expected_template["completion_prompt_config"]["prompt"]["text"]
        )
        assert result == expected_template

    def test_get_baichuan_prompt_chat_app_chat_mode_without_context(self):
        """Test Baichuan prompt: CHAT app + chat mode without context."""
        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "chat", TEST_HAS_CONTEXT_FALSE)

        # Assert
        assert result == copy.deepcopy(BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG)

    def test_get_baichuan_prompt_completion_app_completion_mode(self):
        """Test Baichuan prompt: COMPLETION app + completion mode."""
        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(
            AppMode.COMPLETION, "completion", TEST_HAS_CONTEXT_TRUE
        )

        # Assert
        expected_template = copy.deepcopy(BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG)
        expected_template["completion_prompt_config"]["prompt"]["text"] = (
            BAICHUAN_CONTEXT + expected_template["completion_prompt_config"]["prompt"]["text"]
        )
        assert result == expected_template

    def test_get_baichuan_prompt_completion_app_chat_mode(self):
        """Test Baichuan prompt: COMPLETION app + chat mode."""
        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.COMPLETION, "chat", TEST_HAS_CONTEXT_FALSE)

        # Assert
        assert result == copy.deepcopy(BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG)

    @pytest.mark.parametrize(
        ("app_mode", "model_mode"),
        [
            (AppMode.CHAT, TEST_INVALID_MODE),
            (AppMode.COMPLETION, TEST_INVALID_MODE),
            (TEST_INVALID_MODE, "chat"),
            (TEST_INVALID_MODE, "completion"),
        ],
    )
    def test_get_baichuan_prompt_invalid_modes_return_empty(self, app_mode, model_mode):
        """Test Baichuan prompt returns empty dict for invalid app/model modes."""
        # Act
        result = AdvancedPromptTemplateService.get_baichuan_prompt(app_mode, model_mode, TEST_HAS_CONTEXT_TRUE)

        # Assert
        assert result == {}

    def test_get_completion_prompt_with_context(self):
        """Test completion prompt includes context when has_context is true."""
        # Arrange
        test_template = {"completion_prompt_config": {"prompt": {"text": "test prompt"}}}
        context = "context prefix "

        # Act
        result = AdvancedPromptTemplateService.get_completion_prompt(
            copy.deepcopy(test_template), TEST_HAS_CONTEXT_TRUE, context
        )

        # Assert
        assert result["completion_prompt_config"]["prompt"]["text"] == "context prefix test prompt"

    def test_get_completion_prompt_without_context(self):
        """Test completion prompt remains unchanged when has_context is false."""
        # Arrange
        test_template = {"completion_prompt_config": {"prompt": {"text": "test prompt"}}}
        context = "context prefix "

        # Act
        result = AdvancedPromptTemplateService.get_completion_prompt(
            copy.deepcopy(test_template), TEST_HAS_CONTEXT_FALSE, context
        )

        # Assert
        assert result == test_template

    def test_get_chat_prompt_with_context(self):
        """Test chat prompt includes context when has_context is true."""
        # Arrange
        test_template = {"chat_prompt_config": {"prompt": [{"text": "test prompt"}]}}
        context = "context prefix "

        # Act
        result = AdvancedPromptTemplateService.get_chat_prompt(
            copy.deepcopy(test_template), TEST_HAS_CONTEXT_TRUE, context
        )

        # Assert
        assert result["chat_prompt_config"]["prompt"][0]["text"] == "context prefix test prompt"

    def test_get_chat_prompt_without_context(self):
        """Test chat prompt remains unchanged when has_context is false."""
        # Arrange
        test_template = {"chat_prompt_config": {"prompt": [{"text": "test prompt"}]}}
        context = "context prefix "

        # Act
        result = AdvancedPromptTemplateService.get_chat_prompt(
            copy.deepcopy(test_template), TEST_HAS_CONTEXT_FALSE, context
        )

        # Assert
        assert result == test_template
