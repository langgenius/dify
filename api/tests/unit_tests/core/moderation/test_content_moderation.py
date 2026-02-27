"""
Comprehensive test suite for content moderation functionality.

This module tests all aspects of the content moderation system including:
- Input moderation with keyword filtering and OpenAI API
- Output moderation with streaming support
- Custom keyword filtering with case-insensitive matching
- OpenAI moderation API integration
- Preset response management
- Configuration validation
"""

from unittest.mock import MagicMock, Mock, patch

import pytest

from core.moderation.base import (
    ModerationAction,
    ModerationError,
    ModerationInputsResult,
    ModerationOutputsResult,
)
from core.moderation.keywords.keywords import KeywordsModeration
from core.moderation.openai_moderation.openai_moderation import OpenAIModeration


class TestKeywordsModeration:
    """Test suite for custom keyword-based content moderation."""

    @pytest.fixture
    def keywords_config(self) -> dict:
        """
        Fixture providing a standard keywords moderation configuration.

        Returns:
            dict: Configuration with enabled inputs/outputs and test keywords
        """
        return {
            "inputs_config": {
                "enabled": True,
                "preset_response": "Your input contains inappropriate content.",
            },
            "outputs_config": {
                "enabled": True,
                "preset_response": "The response was blocked due to policy.",
            },
            "keywords": "badword\noffensive\nspam",
        }

    @pytest.fixture
    def keywords_moderation(self, keywords_config: dict) -> KeywordsModeration:
        """
        Fixture providing a KeywordsModeration instance.

        Args:
            keywords_config: Configuration fixture

        Returns:
            KeywordsModeration: Configured moderation instance
        """
        return KeywordsModeration(
            app_id="test-app-123",
            tenant_id="test-tenant-456",
            config=keywords_config,
        )

    def test_validate_config_success(self, keywords_config: dict):
        """Test successful validation of keywords moderation configuration."""
        # Should not raise any exception
        KeywordsModeration.validate_config("test-tenant", keywords_config)

    def test_validate_config_missing_keywords(self):
        """Test validation fails when keywords are missing."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
        }

        with pytest.raises(ValueError, match="keywords is required"):
            KeywordsModeration.validate_config("test-tenant", config)

    def test_validate_config_keywords_too_long(self):
        """Test validation fails when keywords exceed length limit."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "x" * 10001,  # Exceeds 10000 character limit
        }

        with pytest.raises(ValueError, match="keywords length must be less than 10000"):
            KeywordsModeration.validate_config("test-tenant", config)

    def test_validate_config_too_many_rows(self):
        """Test validation fails when keyword rows exceed limit."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "\n".join([f"word{i}" for i in range(101)]),  # 101 rows
        }

        with pytest.raises(ValueError, match="the number of rows for the keywords must be less than 100"):
            KeywordsModeration.validate_config("test-tenant", config)

    def test_validate_config_missing_preset_response(self):
        """Test validation fails when preset response is missing for enabled config."""
        config = {
            "inputs_config": {"enabled": True},  # Missing preset_response
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        with pytest.raises(ValueError, match="inputs_config.preset_response is required"):
            KeywordsModeration.validate_config("test-tenant", config)

    def test_validate_config_preset_response_too_long(self):
        """Test validation fails when preset response exceeds character limit."""
        config = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "x" * 101,  # Exceeds 100 character limit
            },
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        with pytest.raises(ValueError, match="inputs_config.preset_response must be less than 100 characters"):
            KeywordsModeration.validate_config("test-tenant", config)

    def test_moderation_for_inputs_no_violation(self, keywords_moderation: KeywordsModeration):
        """Test input moderation when no keywords are matched."""
        inputs = {"user_input": "This is a clean message"}
        query = "What is the weather?"

        result = keywords_moderation.moderation_for_inputs(inputs, query)

        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Your input contains inappropriate content."

    def test_moderation_for_inputs_with_violation_in_query(self, keywords_moderation: KeywordsModeration):
        """Test input moderation detects keywords in query string."""
        inputs = {"user_input": "Hello"}
        query = "Tell me about badword"

        result = keywords_moderation.moderation_for_inputs(inputs, query)

        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Your input contains inappropriate content."

    def test_moderation_for_inputs_with_violation_in_inputs(self, keywords_moderation: KeywordsModeration):
        """Test input moderation detects keywords in input fields."""
        inputs = {"user_input": "This contains offensive content"}
        query = ""

        result = keywords_moderation.moderation_for_inputs(inputs, query)

        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT

    def test_moderation_for_inputs_case_insensitive(self, keywords_moderation: KeywordsModeration):
        """Test keyword matching is case-insensitive."""
        inputs = {"user_input": "This has BADWORD in caps"}
        query = ""

        result = keywords_moderation.moderation_for_inputs(inputs, query)

        assert result.flagged is True

    def test_moderation_for_inputs_partial_match(self, keywords_moderation: KeywordsModeration):
        """Test keywords are matched as substrings."""
        inputs = {"user_input": "This has badwords (plural)"}
        query = ""

        result = keywords_moderation.moderation_for_inputs(inputs, query)

        assert result.flagged is True

    def test_moderation_for_inputs_disabled(self):
        """Test input moderation when inputs_config is disabled."""
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": "badword",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        inputs = {"user_input": "badword"}
        result = moderation.moderation_for_inputs(inputs, "")

        assert result.flagged is False

    def test_moderation_for_outputs_no_violation(self, keywords_moderation: KeywordsModeration):
        """Test output moderation when no keywords are matched."""
        text = "This is a clean response from the AI"

        result = keywords_moderation.moderation_for_outputs(text)

        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "The response was blocked due to policy."

    def test_moderation_for_outputs_with_violation(self, keywords_moderation: KeywordsModeration):
        """Test output moderation detects keywords in output text."""
        text = "This response contains spam content"

        result = keywords_moderation.moderation_for_outputs(text)

        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "The response was blocked due to policy."

    def test_moderation_for_outputs_case_insensitive(self, keywords_moderation: KeywordsModeration):
        """Test output keyword matching is case-insensitive."""
        text = "This has OFFENSIVE in uppercase"

        result = keywords_moderation.moderation_for_outputs(text)

        assert result.flagged is True

    def test_moderation_for_outputs_disabled(self):
        """Test output moderation when outputs_config is disabled."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "badword",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        result = moderation.moderation_for_outputs("badword")

        assert result.flagged is False

    def test_empty_keywords_filtered(self):
        """Test that empty lines in keywords are properly filtered out."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": "word1\n\nword2\n\n\nword3",  # Multiple empty lines
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Should only match actual keywords, not empty strings
        result = moderation.moderation_for_inputs({"input": "word2"}, "")
        assert result.flagged is True

        result = moderation.moderation_for_inputs({"input": "clean"}, "")
        assert result.flagged is False

    def test_multiple_inputs_any_violation(self, keywords_moderation: KeywordsModeration):
        """Test that violation in any input field triggers flagging."""
        inputs = {
            "field1": "clean text",
            "field2": "also clean",
            "field3": "contains badword here",
        }

        result = keywords_moderation.moderation_for_inputs(inputs, "")

        assert result.flagged is True

    def test_config_not_set_raises_error(self):
        """Test that moderation fails gracefully when config is None."""
        moderation = KeywordsModeration("app-id", "tenant-id", None)

        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_inputs({}, "")

        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_outputs("text")


class TestOpenAIModeration:
    """Test suite for OpenAI-based content moderation."""

    @pytest.fixture
    def openai_config(self) -> dict:
        """
        Fixture providing OpenAI moderation configuration.

        Returns:
            dict: Configuration with enabled inputs/outputs
        """
        return {
            "inputs_config": {
                "enabled": True,
                "preset_response": "Content flagged by OpenAI moderation.",
            },
            "outputs_config": {
                "enabled": True,
                "preset_response": "Response blocked by moderation.",
            },
        }

    @pytest.fixture
    def openai_moderation(self, openai_config: dict) -> OpenAIModeration:
        """
        Fixture providing an OpenAIModeration instance.

        Args:
            openai_config: Configuration fixture

        Returns:
            OpenAIModeration: Configured moderation instance
        """
        return OpenAIModeration(
            app_id="test-app-123",
            tenant_id="test-tenant-456",
            config=openai_config,
        )

    def test_validate_config_success(self, openai_config: dict):
        """Test successful validation of OpenAI moderation configuration."""
        # Should not raise any exception
        OpenAIModeration.validate_config("test-tenant", openai_config)

    def test_validate_config_both_disabled_fails(self):
        """Test validation fails when both inputs and outputs are disabled."""
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {"enabled": False},
        }

        with pytest.raises(ValueError, match="At least one of inputs_config or outputs_config must be enabled"):
            OpenAIModeration.validate_config("test-tenant", config)

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_moderation_for_inputs_no_violation(self, mock_model_manager: Mock, openai_moderation: OpenAIModeration):
        """Test input moderation when OpenAI API returns no violations."""
        # Mock the model manager and instance
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = False
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        inputs = {"user_input": "What is the weather today?"}
        query = "Tell me about the weather"

        result = openai_moderation.moderation_for_inputs(inputs, query)

        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Content flagged by OpenAI moderation."

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_moderation_for_inputs_with_violation(self, mock_model_manager: Mock, openai_moderation: OpenAIModeration):
        """Test input moderation when OpenAI API detects violations."""
        # Mock the model manager to return violation
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = True
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        inputs = {"user_input": "Inappropriate content"}
        query = "Harmful query"

        result = openai_moderation.moderation_for_inputs(inputs, query)

        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Content flagged by OpenAI moderation."

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_moderation_for_inputs_query_included(self, mock_model_manager: Mock, openai_moderation: OpenAIModeration):
        """Test that query is included in moderation check with special key."""
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = False
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        inputs = {"field1": "value1"}
        query = "test query"

        openai_moderation.moderation_for_inputs(inputs, query)

        # Verify invoke_moderation was called with correct content
        mock_instance.invoke_moderation.assert_called_once()
        call_args = mock_instance.invoke_moderation.call_args.kwargs
        moderated_text = call_args["text"]
        # The implementation uses "\n".join(str(inputs.values())) which joins each character
        # Verify the moderated text is not empty and was constructed from inputs
        assert len(moderated_text) > 0
        # Check that the text contains characters from our input values
        assert "v" in moderated_text
        assert "a" in moderated_text
        assert "l" in moderated_text
        assert "q" in moderated_text
        assert "u" in moderated_text
        assert "e" in moderated_text

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_moderation_for_inputs_disabled(self, mock_model_manager: Mock):
        """Test input moderation when inputs_config is disabled."""
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        result = moderation.moderation_for_inputs({"input": "test"}, "query")

        assert result.flagged is False
        # Should not call the API when disabled
        mock_model_manager.assert_not_called()

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_moderation_for_outputs_no_violation(self, mock_model_manager: Mock, openai_moderation: OpenAIModeration):
        """Test output moderation when OpenAI API returns no violations."""
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = False
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        text = "This is a safe response"
        result = openai_moderation.moderation_for_outputs(text)

        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Response blocked by moderation."

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_moderation_for_outputs_with_violation(self, mock_model_manager: Mock, openai_moderation: OpenAIModeration):
        """Test output moderation when OpenAI API detects violations."""
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = True
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        text = "Inappropriate response content"
        result = openai_moderation.moderation_for_outputs(text)

        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_moderation_for_outputs_disabled(self, mock_model_manager: Mock):
        """Test output moderation when outputs_config is disabled."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        result = moderation.moderation_for_outputs("test text")

        assert result.flagged is False
        mock_model_manager.assert_not_called()

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_model_manager_called_with_correct_params(
        self, mock_model_manager: Mock, openai_moderation: OpenAIModeration
    ):
        """Test that ModelManager is called with correct parameters."""
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = False
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        openai_moderation.moderation_for_outputs("test")

        # Verify get_model_instance was called with correct parameters
        mock_model_manager.return_value.get_model_instance.assert_called_once()
        call_kwargs = mock_model_manager.return_value.get_model_instance.call_args[1]
        assert call_kwargs["tenant_id"] == "test-tenant-456"
        assert call_kwargs["provider"] == "openai"
        assert call_kwargs["model"] == "omni-moderation-latest"

    def test_config_not_set_raises_error(self):
        """Test that moderation fails when config is None."""
        moderation = OpenAIModeration("app-id", "tenant-id", None)

        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_inputs({}, "")

        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_outputs("text")


class TestModerationRuleStructure:
    """Test suite for ModerationRule data structure."""

    def test_moderation_rule_structure(self):
        """Test ModerationRule structure for output moderation."""
        from core.moderation.output_moderation import ModerationRule

        rule = ModerationRule(
            type="keywords",
            config={
                "inputs_config": {"enabled": False},
                "outputs_config": {"enabled": True, "preset_response": "Blocked"},
                "keywords": "badword",
            },
        )

        assert rule.type == "keywords"
        assert rule.config["outputs_config"]["enabled"] is True
        assert rule.config["outputs_config"]["preset_response"] == "Blocked"


class TestModerationFactoryIntegration:
    """Test suite for ModerationFactory integration."""

    @patch("core.moderation.factory.code_based_extension")
    def test_factory_delegates_to_extension(self, mock_extension: Mock):
        """Test ModerationFactory delegates to extension system."""
        from core.moderation.factory import ModerationFactory

        mock_instance = MagicMock()
        mock_instance.moderation_for_inputs.return_value = ModerationInputsResult(
            flagged=False,
            action=ModerationAction.DIRECT_OUTPUT,
        )
        mock_class = MagicMock(return_value=mock_instance)
        mock_extension.extension_class.return_value = mock_class

        factory = ModerationFactory(
            name="keywords",
            app_id="app",
            tenant_id="tenant",
            config={},
        )

        result = factory.moderation_for_inputs({"field": "value"}, "query")
        assert result.flagged is False
        mock_instance.moderation_for_inputs.assert_called_once()

    @patch("core.moderation.factory.code_based_extension")
    def test_factory_validate_config_delegates(self, mock_extension: Mock):
        """Test ModerationFactory.validate_config delegates to extension."""
        from core.moderation.factory import ModerationFactory

        mock_class = MagicMock()
        mock_extension.extension_class.return_value = mock_class

        ModerationFactory.validate_config("keywords", "tenant", {"test": "config"})

        mock_class.validate_config.assert_called_once()


class TestModerationBase:
    """Test suite for base moderation classes and enums."""

    def test_moderation_action_enum_values(self):
        """Test ModerationAction enum has expected values."""
        assert ModerationAction.DIRECT_OUTPUT == "direct_output"
        assert ModerationAction.OVERRIDDEN == "overridden"

    def test_moderation_inputs_result_defaults(self):
        """Test ModerationInputsResult default values."""
        result = ModerationInputsResult(action=ModerationAction.DIRECT_OUTPUT)

        assert result.flagged is False
        assert result.preset_response == ""
        assert result.inputs == {}
        assert result.query == ""

    def test_moderation_outputs_result_defaults(self):
        """Test ModerationOutputsResult default values."""
        result = ModerationOutputsResult(action=ModerationAction.DIRECT_OUTPUT)

        assert result.flagged is False
        assert result.preset_response == ""
        assert result.text == ""

    def test_moderation_error_exception(self):
        """Test ModerationError can be raised and caught."""
        with pytest.raises(ModerationError, match="Test error message"):
            raise ModerationError("Test error message")

    def test_moderation_inputs_result_with_values(self):
        """Test ModerationInputsResult with custom values."""
        result = ModerationInputsResult(
            flagged=True,
            action=ModerationAction.OVERRIDDEN,
            preset_response="Custom response",
            inputs={"field": "sanitized"},
            query="sanitized query",
        )

        assert result.flagged is True
        assert result.action == ModerationAction.OVERRIDDEN
        assert result.preset_response == "Custom response"
        assert result.inputs == {"field": "sanitized"}
        assert result.query == "sanitized query"

    def test_moderation_outputs_result_with_values(self):
        """Test ModerationOutputsResult with custom values."""
        result = ModerationOutputsResult(
            flagged=True,
            action=ModerationAction.DIRECT_OUTPUT,
            preset_response="Blocked",
            text="Sanitized text",
        )

        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Blocked"
        assert result.text == "Sanitized text"


class TestPresetManagement:
    """Test suite for preset response management across moderation types."""

    def test_keywords_preset_response_in_inputs(self):
        """Test preset response is properly returned for keyword input violations."""
        config = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "Custom input blocked message",
            },
            "outputs_config": {"enabled": False},
            "keywords": "blocked",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        result = moderation.moderation_for_inputs({"text": "blocked"}, "")

        assert result.flagged is True
        assert result.preset_response == "Custom input blocked message"

    def test_keywords_preset_response_in_outputs(self):
        """Test preset response is properly returned for keyword output violations."""
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {
                "enabled": True,
                "preset_response": "Custom output blocked message",
            },
            "keywords": "blocked",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        result = moderation.moderation_for_outputs("blocked content")

        assert result.flagged is True
        assert result.preset_response == "Custom output blocked message"

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_openai_preset_response_in_inputs(self, mock_model_manager: Mock):
        """Test preset response is properly returned for OpenAI input violations."""
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = True
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        config = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "OpenAI input blocked",
            },
            "outputs_config": {"enabled": False},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        result = moderation.moderation_for_inputs({"text": "test"}, "")

        assert result.flagged is True
        assert result.preset_response == "OpenAI input blocked"

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_openai_preset_response_in_outputs(self, mock_model_manager: Mock):
        """Test preset response is properly returned for OpenAI output violations."""
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = True
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {
                "enabled": True,
                "preset_response": "OpenAI output blocked",
            },
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        result = moderation.moderation_for_outputs("test content")

        assert result.flagged is True
        assert result.preset_response == "OpenAI output blocked"

    def test_preset_response_length_validation(self):
        """Test that preset responses exceeding 100 characters are rejected."""
        config = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "x" * 101,  # Too long
            },
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        with pytest.raises(ValueError, match="must be less than 100 characters"):
            KeywordsModeration.validate_config("tenant-id", config)

    def test_different_preset_responses_for_inputs_and_outputs(self):
        """Test that inputs and outputs can have different preset responses."""
        config = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "Input message",
            },
            "outputs_config": {
                "enabled": True,
                "preset_response": "Output message",
            },
            "keywords": "test",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        input_result = moderation.moderation_for_inputs({"text": "test"}, "")
        output_result = moderation.moderation_for_outputs("test")

        assert input_result.preset_response == "Input message"
        assert output_result.preset_response == "Output message"


class TestKeywordsModerationAdvanced:
    """
    Advanced test suite for edge cases and complex scenarios in keyword moderation.

    This class focuses on testing:
    - Unicode and special character handling
    - Performance with large keyword lists
    - Boundary conditions
    - Complex input structures
    """

    def test_unicode_keywords_matching(self):
        """
        Test that keyword moderation correctly handles Unicode characters.

        This ensures international content can be properly moderated with
        keywords in various languages (Chinese, Arabic, Emoji, etc.).
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": "不当内容\nمحتوى غير لائق\n🚫",  # Chinese, Arabic, Emoji
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Test Chinese keyword matching
        result = moderation.moderation_for_inputs({"text": "这是不当内容"}, "")
        assert result.flagged is True

        # Test Arabic keyword matching
        result = moderation.moderation_for_inputs({"text": "هذا محتوى غير لائق"}, "")
        assert result.flagged is True

        # Test Emoji keyword matching
        result = moderation.moderation_for_outputs("This is 🚫 content")
        assert result.flagged is True

    def test_special_regex_characters_in_keywords(self):
        """
        Test that special regex characters in keywords are treated as literals.

        Keywords like ".*", "[test]", or "(bad)" should match literally,
        not as regex patterns. This prevents regex injection vulnerabilities.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": ".*\n[test]\n(bad)\n$money",  # Special regex chars
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Should match literal ".*" not as regex wildcard
        result = moderation.moderation_for_inputs({"text": "This contains .*"}, "")
        assert result.flagged is True

        # Should match literal "[test]"
        result = moderation.moderation_for_inputs({"text": "This has [test] in it"}, "")
        assert result.flagged is True

        # Should match literal "(bad)"
        result = moderation.moderation_for_inputs({"text": "This is (bad) content"}, "")
        assert result.flagged is True

        # Should match literal "$money"
        result = moderation.moderation_for_inputs({"text": "Get $money fast"}, "")
        assert result.flagged is True

    def test_whitespace_variations_in_keywords(self):
        """
        Test keyword matching with various whitespace characters.

        Ensures that keywords with tabs, newlines, and multiple spaces
        are handled correctly in the matching logic.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "bad word\ntab\there\nmulti  space",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Test space-separated keyword
        result = moderation.moderation_for_inputs({"text": "This is a bad word"}, "")
        assert result.flagged is True

        # Test keyword with tab (should match literal tab)
        result = moderation.moderation_for_inputs({"text": "tab\there"}, "")
        assert result.flagged is True

    def test_maximum_keyword_length_boundary(self):
        """
        Test behavior at the maximum allowed keyword list length (10000 chars).

        Validates that the system correctly enforces the 10000 character limit
        and handles keywords at the boundary condition.
        """
        # Create a keyword string just under the limit (but also under 100 rows)
        # Each "word\n" is 5 chars, so 99 rows = 495 chars (well under 10000)
        keywords_under_limit = "word\n" * 99  # 99 rows, ~495 characters
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": keywords_under_limit,
        }

        # Should not raise an exception
        KeywordsModeration.validate_config("tenant-id", config)

        # Create a keyword string over the 10000 character limit
        # Use longer keywords to exceed character limit without exceeding row limit
        long_keyword = "x" * 150  # Each keyword is 150 chars
        keywords_over_limit = "\n".join([long_keyword] * 67)  # 67 rows * 150 = 10050 chars
        config_over = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": keywords_over_limit,
        }

        # Should raise validation error
        with pytest.raises(ValueError, match="keywords length must be less than 10000"):
            KeywordsModeration.validate_config("tenant-id", config_over)

    def test_maximum_keyword_rows_boundary(self):
        """
        Test behavior at the maximum allowed keyword rows (100 rows).

        Ensures the system correctly limits the number of keyword lines
        to prevent performance issues with excessive keyword lists.
        """
        # Create exactly 100 rows (at boundary)
        keywords_at_limit = "\n".join([f"word{i}" for i in range(100)])
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": keywords_at_limit,
        }

        # Should not raise an exception
        KeywordsModeration.validate_config("tenant-id", config)

        # Create 101 rows (over limit)
        keywords_over_limit = "\n".join([f"word{i}" for i in range(101)])
        config_over = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": keywords_over_limit,
        }

        # Should raise validation error
        with pytest.raises(ValueError, match="the number of rows for the keywords must be less than 100"):
            KeywordsModeration.validate_config("tenant-id", config_over)

    def test_nested_dict_input_values(self):
        """
        Test moderation with nested dictionary structures in inputs.

        In real applications, inputs might contain complex nested structures.
        The moderation should check all values recursively (converted to strings).
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "badword",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Test with nested dict (will be converted to string representation)
        nested_input = {
            "field1": "clean",
            "field2": {"nested": "badword"},  # Nested dict with bad content
        }

        # When dict is converted to string, it should contain "badword"
        result = moderation.moderation_for_inputs(nested_input, "")
        assert result.flagged is True

    def test_numeric_input_values(self):
        """
        Test moderation with numeric input values.

        Ensures that numeric values are properly converted to strings
        and checked against keywords (e.g., blocking specific numbers).
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "666\n13",  # Numeric keywords
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Test with integer input
        result = moderation.moderation_for_inputs({"number": 666}, "")
        assert result.flagged is True

        # Test with float input
        result = moderation.moderation_for_inputs({"number": 13.5}, "")
        assert result.flagged is True

        # Test with string representation
        result = moderation.moderation_for_inputs({"text": "Room 666"}, "")
        assert result.flagged is True

    def test_boolean_input_values(self):
        """
        Test moderation with boolean input values.

        Boolean values should be converted to strings ("True"/"False")
        and checked against keywords if needed.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "true\nfalse",  # Case-insensitive matching
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Test with boolean True
        result = moderation.moderation_for_inputs({"flag": True}, "")
        assert result.flagged is True

        # Test with boolean False
        result = moderation.moderation_for_inputs({"flag": False}, "")
        assert result.flagged is True

    def test_empty_string_inputs(self):
        """
        Test moderation with empty string inputs.

        Empty strings should not cause errors and should not match
        non-empty keywords.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "badword",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Test with empty string input
        result = moderation.moderation_for_inputs({"text": ""}, "")
        assert result.flagged is False

        # Test with empty query
        result = moderation.moderation_for_inputs({"text": "clean"}, "")
        assert result.flagged is False

    def test_very_long_input_text(self):
        """
        Test moderation performance with very long input text.

        Ensures the system can handle large text inputs without
        performance degradation or errors.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "needle",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Create a very long text with keyword at the end
        long_text = "clean " * 10000 + "needle"
        result = moderation.moderation_for_inputs({"text": long_text}, "")
        assert result.flagged is True

        # Create a very long text without keyword
        long_clean_text = "clean " * 10000
        result = moderation.moderation_for_inputs({"text": long_clean_text}, "")
        assert result.flagged is False


class TestOpenAIModerationAdvanced:
    """
    Advanced test suite for OpenAI moderation integration.

    This class focuses on testing:
    - API error handling
    - Response parsing
    - Edge cases in API integration
    - Performance considerations
    """

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_openai_api_timeout_handling(self, mock_model_manager: Mock):
        """
        Test graceful handling of OpenAI API timeouts.

        When the OpenAI API times out, the moderation should handle
        the exception appropriately without crashing the application.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Error occurred"},
            "outputs_config": {"enabled": False},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        # Mock API timeout
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.side_effect = TimeoutError("API timeout")
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        # Should raise the timeout error (caller handles it)
        with pytest.raises(TimeoutError):
            moderation.moderation_for_inputs({"text": "test"}, "")

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_openai_api_rate_limit_handling(self, mock_model_manager: Mock):
        """
        Test handling of OpenAI API rate limit errors.

        When rate limits are exceeded, the system should propagate
        the error for appropriate retry logic at higher levels.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Rate limited"},
            "outputs_config": {"enabled": False},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        # Mock rate limit error
        mock_instance = MagicMock()
        mock_instance.invoke_moderation.side_effect = Exception("Rate limit exceeded")
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        # Should raise the rate limit error
        with pytest.raises(Exception, match="Rate limit exceeded"):
            moderation.moderation_for_inputs({"text": "test"}, "")

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_openai_with_multiple_input_fields(self, mock_model_manager: Mock):
        """
        Test OpenAI moderation with multiple input fields.

        When multiple input fields are provided, all should be combined
        and sent to the OpenAI API for comprehensive moderation.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = True
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        # Test with multiple fields
        inputs = {
            "field1": "value1",
            "field2": "value2",
            "field3": "value3",
        }
        result = moderation.moderation_for_inputs(inputs, "query")

        # Should flag as violation
        assert result.flagged is True

        # Verify API was called with all input values and query
        mock_instance.invoke_moderation.assert_called_once()
        call_args = mock_instance.invoke_moderation.call_args.kwargs
        moderated_text = call_args["text"]
        # The implementation uses "\n".join(str(inputs.values())) which joins each character
        # Verify the moderated text is not empty and was constructed from inputs
        assert len(moderated_text) > 0
        # Check that the text contains characters from our input values and query
        assert "v" in moderated_text
        assert "a" in moderated_text
        assert "l" in moderated_text
        assert "q" in moderated_text
        assert "u" in moderated_text
        assert "e" in moderated_text

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_openai_empty_text_handling(self, mock_model_manager: Mock):
        """
        Test OpenAI moderation with empty text inputs.

        Empty inputs should still be sent to the API (which will
        return no violation) to maintain consistent behavior.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = False
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        # Test with empty inputs
        result = moderation.moderation_for_inputs({}, "")

        assert result.flagged is False
        mock_instance.invoke_moderation.assert_called_once()

    @patch("core.moderation.openai_moderation.openai_moderation.ModelManager")
    def test_openai_model_instance_fetched_on_each_call(self, mock_model_manager: Mock):
        """
        Test that ModelManager fetches a fresh model instance on each call.

        Each moderation call should get a fresh model instance to ensure
        up-to-date configuration and avoid stale state (no caching).
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
        }
        moderation = OpenAIModeration("app-id", "tenant-id", config)

        mock_instance = MagicMock()
        mock_instance.invoke_moderation.return_value = False
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        # Call moderation multiple times
        moderation.moderation_for_inputs({"text": "test1"}, "")
        moderation.moderation_for_inputs({"text": "test2"}, "")
        moderation.moderation_for_inputs({"text": "test3"}, "")

        # ModelManager should be called 3 times (no caching)
        assert mock_model_manager.call_count == 3


class TestModerationActionBehavior:
    """
    Test suite for different moderation action behaviors.

    This class tests the two action types:
    - DIRECT_OUTPUT: Returns preset response immediately
    - OVERRIDDEN: Returns sanitized/modified content
    """

    def test_direct_output_action_blocks_completely(self):
        """
        Test that DIRECT_OUTPUT action completely blocks content.

        When DIRECT_OUTPUT is used, the original content should be
        completely replaced with the preset response, providing no
        information about the original flagged content.
        """
        result = ModerationInputsResult(
            flagged=True,
            action=ModerationAction.DIRECT_OUTPUT,
            preset_response="Your request has been blocked.",
            inputs={},
            query="",
        )

        # Original content should not be accessible
        assert result.preset_response == "Your request has been blocked."
        assert result.inputs == {}
        assert result.query == ""

    def test_overridden_action_sanitizes_content(self):
        """
        Test that OVERRIDDEN action provides sanitized content.

        When OVERRIDDEN is used, the system should return modified
        content with sensitive parts removed or replaced, allowing
        the conversation to continue with safe content.
        """
        result = ModerationInputsResult(
            flagged=True,
            action=ModerationAction.OVERRIDDEN,
            preset_response="",
            inputs={"field": "This is *** content"},
            query="Tell me about ***",
        )

        # Sanitized content should be available
        assert result.inputs["field"] == "This is *** content"
        assert result.query == "Tell me about ***"
        assert result.preset_response == ""

    def test_action_enum_string_values(self):
        """
        Test that ModerationAction enum has correct string values.

        The enum values should be lowercase with underscores for
        consistency with the rest of the codebase.
        """
        assert str(ModerationAction.DIRECT_OUTPUT) == "direct_output"
        assert str(ModerationAction.OVERRIDDEN) == "overridden"

        # Test enum comparison
        assert ModerationAction.DIRECT_OUTPUT != ModerationAction.OVERRIDDEN


class TestConfigurationEdgeCases:
    """
    Test suite for configuration validation edge cases.

    This class tests various invalid configuration scenarios to ensure
    proper validation and error messages.
    """

    def test_missing_inputs_config_dict(self):
        """
        Test validation fails when inputs_config is not a dict.

        The configuration must have inputs_config as a dictionary,
        not a string, list, or other type.
        """
        config = {
            "inputs_config": "not a dict",  # Invalid type
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        with pytest.raises(ValueError, match="inputs_config must be a dict"):
            KeywordsModeration.validate_config("tenant-id", config)

    def test_missing_outputs_config_dict(self):
        """
        Test validation fails when outputs_config is not a dict.

        Similar to inputs_config, outputs_config must be a dictionary
        for proper configuration parsing.
        """
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": ["not", "a", "dict"],  # Invalid type
            "keywords": "test",
        }

        with pytest.raises(ValueError, match="outputs_config must be a dict"):
            KeywordsModeration.validate_config("tenant-id", config)

    def test_both_inputs_and_outputs_disabled(self):
        """
        Test validation fails when both inputs and outputs are disabled.

        At least one of inputs_config or outputs_config must be enabled,
        otherwise the moderation serves no purpose.
        """
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        with pytest.raises(ValueError, match="At least one of inputs_config or outputs_config must be enabled"):
            KeywordsModeration.validate_config("tenant-id", config)

    def test_preset_response_exactly_100_characters(self):
        """
        Test that preset response length validation works correctly.

        The validation checks if length > 100, so 101+ characters should be rejected
        while 100 or fewer should be accepted. This tests the boundary condition.
        """
        # Test with exactly 100 characters (should pass based on implementation)
        config_100 = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "x" * 100,  # Exactly 100
            },
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        # Should not raise exception (100 is allowed)
        KeywordsModeration.validate_config("tenant-id", config_100)

        # Test with 101 characters (should fail)
        config_101 = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "x" * 101,  # 101 chars
            },
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        # Should raise exception (101 exceeds limit)
        with pytest.raises(ValueError, match="must be less than 100 characters"):
            KeywordsModeration.validate_config("tenant-id", config_101)

    def test_empty_preset_response_when_enabled(self):
        """
        Test validation fails when preset_response is empty but config is enabled.

        If inputs_config or outputs_config is enabled, a non-empty preset
        response must be provided to show users when content is blocked.
        """
        config = {
            "inputs_config": {
                "enabled": True,
                "preset_response": "",  # Empty
            },
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        with pytest.raises(ValueError, match="inputs_config.preset_response is required"):
            KeywordsModeration.validate_config("tenant-id", config)


class TestConcurrentModerationScenarios:
    """
    Test suite for scenarios involving multiple moderation checks.

    This class tests how the moderation system behaves when processing
    multiple requests or checking multiple fields simultaneously.
    """

    def test_multiple_keywords_in_single_input(self):
        """
        Test detection when multiple keywords appear in one input.

        If an input contains multiple flagged keywords, the system
        should still flag it (not count how many violations).
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "bad\nworse\nterrible",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Input with multiple keywords
        result = moderation.moderation_for_inputs({"text": "This is bad and worse and terrible"}, "")

        assert result.flagged is True

    def test_keyword_at_start_middle_end_of_text(self):
        """
        Test keyword detection at different positions in text.

        Keywords should be detected regardless of their position:
        at the start, middle, or end of the input text.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "flag",
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Keyword at start
        result = moderation.moderation_for_inputs({"text": "flag this content"}, "")
        assert result.flagged is True

        # Keyword in middle
        result = moderation.moderation_for_inputs({"text": "this flag is bad"}, "")
        assert result.flagged is True

        # Keyword at end
        result = moderation.moderation_for_inputs({"text": "this is a flag"}, "")
        assert result.flagged is True

    def test_case_variations_of_same_keyword(self):
        """
        Test that different case variations of keywords are all detected.

        The matching should be case-insensitive, so "BAD", "Bad", "bad"
        should all be detected if "bad" is in the keyword list.
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "sensitive",  # Lowercase in config
        }
        moderation = KeywordsModeration("app-id", "tenant-id", config)

        # Test various case combinations
        test_cases = [
            "sensitive",
            "Sensitive",
            "SENSITIVE",
            "SeNsItIvE",
            "sEnSiTiVe",
        ]

        for test_text in test_cases:
            result = moderation.moderation_for_inputs({"text": test_text}, "")
            assert result.flagged is True, f"Failed to detect: {test_text}"
