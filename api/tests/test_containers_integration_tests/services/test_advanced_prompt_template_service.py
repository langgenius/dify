import copy

import pytest
from faker import Faker

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
    """Integration tests for AdvancedPromptTemplateService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        # This service doesn't have external dependencies, but we keep the pattern
        # for consistency with other test files
        return {}

    def test_get_prompt_baichuan_model_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful prompt generation for Baichuan model.

        This test verifies:
        - Proper prompt generation for Baichuan models
        - Correct model detection logic
        - Appropriate prompt template selection
        """
        fake = Faker()

        # Test data for Baichuan model
        args = {
            "app_mode": AppMode.CHAT,
            "model_mode": "completion",
            "model_name": "baichuan-13b-chat",
            "has_context": "true",
        }

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_prompt(args)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]

        # Verify context is included for Baichuan model
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert BAICHUAN_CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text
        assert "{{#histories#}}" in prompt_text
        assert "{{#query#}}" in prompt_text

    def test_get_prompt_common_model_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful prompt generation for common models.

        This test verifies:
        - Proper prompt generation for non-Baichuan models
        - Correct model detection logic
        - Appropriate prompt template selection
        """
        fake = Faker()

        # Test data for common model
        args = {
            "app_mode": AppMode.CHAT,
            "model_mode": "completion",
            "model_name": "gpt-3.5-turbo",
            "has_context": "true",
        }

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_prompt(args)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]

        # Verify context is included for common model
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text
        assert "{{#histories#}}" in prompt_text
        assert "{{#query#}}" in prompt_text

    def test_get_prompt_case_insensitive_baichuan_detection(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Baichuan model detection is case insensitive.

        This test verifies:
        - Model name detection works regardless of case
        - Proper prompt template selection for different case variations
        """
        fake = Faker()

        # Test different case variations
        test_cases = ["Baichuan-13B-Chat", "BAICHUAN-13B-CHAT", "baichuan-13b-chat", "BaiChuan-13B-Chat"]

        for model_name in test_cases:
            args = {
                "app_mode": AppMode.CHAT,
                "model_mode": "completion",
                "model_name": model_name,
                "has_context": "true",
            }

            # Act: Execute the method under test
            result = AdvancedPromptTemplateService.get_prompt(args)

            # Assert: Verify Baichuan template is used
            assert result is not None
            prompt_text = result["completion_prompt_config"]["prompt"]["text"]
            assert BAICHUAN_CONTEXT in prompt_text

    def test_get_common_prompt_chat_app_completion_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test common prompt generation for chat app with completion mode.

        This test verifies:
        - Correct prompt template selection for chat app + completion mode
        - Proper context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "completion", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]
        assert "conversation_histories_role" in result["completion_prompt_config"]
        assert "stop" in result

        # Verify context is included
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text
        assert "{{#histories#}}" in prompt_text
        assert "{{#query#}}" in prompt_text

    def test_get_common_prompt_chat_app_chat_mode(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test common prompt generation for chat app with chat mode.

        This test verifies:
        - Correct prompt template selection for chat app + chat mode
        - Proper context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "chat", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "chat_prompt_config" in result
        assert "prompt" in result["chat_prompt_config"]
        assert len(result["chat_prompt_config"]["prompt"]) > 0
        assert "role" in result["chat_prompt_config"]["prompt"][0]
        assert "text" in result["chat_prompt_config"]["prompt"][0]

        # Verify context is included
        prompt_text = result["chat_prompt_config"]["prompt"][0]["text"]
        assert CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text

    def test_get_common_prompt_completion_app_completion_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test common prompt generation for completion app with completion mode.

        This test verifies:
        - Correct prompt template selection for completion app + completion mode
        - Proper context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.COMPLETION, "completion", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]
        assert "stop" in result

        # Verify context is included
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text

    def test_get_common_prompt_completion_app_chat_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test common prompt generation for completion app with chat mode.

        This test verifies:
        - Correct prompt template selection for completion app + chat mode
        - Proper context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.COMPLETION, "chat", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "chat_prompt_config" in result
        assert "prompt" in result["chat_prompt_config"]
        assert len(result["chat_prompt_config"]["prompt"]) > 0
        assert "role" in result["chat_prompt_config"]["prompt"][0]
        assert "text" in result["chat_prompt_config"]["prompt"][0]

        # Verify context is included
        prompt_text = result["chat_prompt_config"]["prompt"][0]["text"]
        assert CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text

    def test_get_common_prompt_no_context(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test common prompt generation without context.

        This test verifies:
        - Correct handling when has_context is "false"
        - Context is not included in prompt
        - Template structure remains intact
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "completion", "false")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]

        # Verify context is NOT included
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert CONTEXT not in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text
        assert "{{#histories#}}" in prompt_text
        assert "{{#query#}}" in prompt_text

    def test_get_common_prompt_unsupported_app_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test common prompt generation with unsupported app mode.

        This test verifies:
        - Proper handling of unsupported app modes
        - Default empty dict return
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_common_prompt("unsupported_mode", "completion", "true")

        # Assert: Verify empty dict is returned
        assert result == {}

    def test_get_common_prompt_unsupported_model_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test common prompt generation with unsupported model mode.

        This test verifies:
        - Proper handling of unsupported model modes
        - Default empty dict return
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_common_prompt(AppMode.CHAT, "unsupported_mode", "true")

        # Assert: Verify empty dict is returned
        assert result == {}

    def test_get_completion_prompt_with_context(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test completion prompt generation with context.

        This test verifies:
        - Proper context integration in completion prompts
        - Template structure preservation
        - Context placement at the beginning
        """
        fake = Faker()

        # Create test prompt template
        prompt_template = copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG)
        original_text = prompt_template["completion_prompt_config"]["prompt"]["text"]

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_completion_prompt(prompt_template, "true", CONTEXT)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]

        # Verify context is prepended to original text
        result_text = result["completion_prompt_config"]["prompt"]["text"]
        assert result_text.startswith(CONTEXT)
        assert original_text in result_text
        assert result_text == CONTEXT + original_text

    def test_get_completion_prompt_without_context(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test completion prompt generation without context.

        This test verifies:
        - Original template is preserved when no context
        - No modification to prompt text
        """
        fake = Faker()

        # Create test prompt template
        prompt_template = copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG)
        original_text = prompt_template["completion_prompt_config"]["prompt"]["text"]

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_completion_prompt(prompt_template, "false", CONTEXT)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]

        # Verify original text is unchanged
        result_text = result["completion_prompt_config"]["prompt"]["text"]
        assert result_text == original_text
        assert CONTEXT not in result_text

    def test_get_chat_prompt_with_context(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test chat prompt generation with context.

        This test verifies:
        - Proper context integration in chat prompts
        - Template structure preservation
        - Context placement at the beginning of first message
        """
        fake = Faker()

        # Create test prompt template
        prompt_template = copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG)
        original_text = prompt_template["chat_prompt_config"]["prompt"][0]["text"]

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_chat_prompt(prompt_template, "true", CONTEXT)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "chat_prompt_config" in result
        assert "prompt" in result["chat_prompt_config"]
        assert len(result["chat_prompt_config"]["prompt"]) > 0
        assert "text" in result["chat_prompt_config"]["prompt"][0]

        # Verify context is prepended to original text
        result_text = result["chat_prompt_config"]["prompt"][0]["text"]
        assert result_text.startswith(CONTEXT)
        assert original_text in result_text
        assert result_text == CONTEXT + original_text

    def test_get_chat_prompt_without_context(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test chat prompt generation without context.

        This test verifies:
        - Original template is preserved when no context
        - No modification to prompt text
        """
        fake = Faker()

        # Create test prompt template
        prompt_template = copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG)
        original_text = prompt_template["chat_prompt_config"]["prompt"][0]["text"]

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_chat_prompt(prompt_template, "false", CONTEXT)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "chat_prompt_config" in result
        assert "prompt" in result["chat_prompt_config"]
        assert len(result["chat_prompt_config"]["prompt"]) > 0
        assert "text" in result["chat_prompt_config"]["prompt"][0]

        # Verify original text is unchanged
        result_text = result["chat_prompt_config"]["prompt"][0]["text"]
        assert result_text == original_text
        assert CONTEXT not in result_text

    def test_get_baichuan_prompt_chat_app_completion_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Baichuan prompt generation for chat app with completion mode.

        This test verifies:
        - Correct Baichuan prompt template selection for chat app + completion mode
        - Proper Baichuan context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "completion", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]
        assert "conversation_histories_role" in result["completion_prompt_config"]
        assert "stop" in result

        # Verify Baichuan context is included
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert BAICHUAN_CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text
        assert "{{#histories#}}" in prompt_text
        assert "{{#query#}}" in prompt_text

    def test_get_baichuan_prompt_chat_app_chat_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Baichuan prompt generation for chat app with chat mode.

        This test verifies:
        - Correct Baichuan prompt template selection for chat app + chat mode
        - Proper Baichuan context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "chat", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "chat_prompt_config" in result
        assert "prompt" in result["chat_prompt_config"]
        assert len(result["chat_prompt_config"]["prompt"]) > 0
        assert "role" in result["chat_prompt_config"]["prompt"][0]
        assert "text" in result["chat_prompt_config"]["prompt"][0]

        # Verify Baichuan context is included
        prompt_text = result["chat_prompt_config"]["prompt"][0]["text"]
        assert BAICHUAN_CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text

    def test_get_baichuan_prompt_completion_app_completion_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Baichuan prompt generation for completion app with completion mode.

        This test verifies:
        - Correct Baichuan prompt template selection for completion app + completion mode
        - Proper Baichuan context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.COMPLETION, "completion", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]
        assert "stop" in result

        # Verify Baichuan context is included
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert BAICHUAN_CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text

    def test_get_baichuan_prompt_completion_app_chat_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Baichuan prompt generation for completion app with chat mode.

        This test verifies:
        - Correct Baichuan prompt template selection for completion app + chat mode
        - Proper Baichuan context integration
        - Template structure validation
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.COMPLETION, "chat", "true")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "chat_prompt_config" in result
        assert "prompt" in result["chat_prompt_config"]
        assert len(result["chat_prompt_config"]["prompt"]) > 0
        assert "role" in result["chat_prompt_config"]["prompt"][0]
        assert "text" in result["chat_prompt_config"]["prompt"][0]

        # Verify Baichuan context is included
        prompt_text = result["chat_prompt_config"]["prompt"][0]["text"]
        assert BAICHUAN_CONTEXT in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text

    def test_get_baichuan_prompt_no_context(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test Baichuan prompt generation without context.

        This test verifies:
        - Correct handling when has_context is "false"
        - Baichuan context is not included in prompt
        - Template structure remains intact
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "completion", "false")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert "completion_prompt_config" in result
        assert "prompt" in result["completion_prompt_config"]
        assert "text" in result["completion_prompt_config"]["prompt"]

        # Verify Baichuan context is NOT included
        prompt_text = result["completion_prompt_config"]["prompt"]["text"]
        assert BAICHUAN_CONTEXT not in prompt_text
        assert "{{#pre_prompt#}}" in prompt_text
        assert "{{#histories#}}" in prompt_text
        assert "{{#query#}}" in prompt_text

    def test_get_baichuan_prompt_unsupported_app_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Baichuan prompt generation with unsupported app mode.

        This test verifies:
        - Proper handling of unsupported app modes
        - Default empty dict return
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_baichuan_prompt("unsupported_mode", "completion", "true")

        # Assert: Verify empty dict is returned
        assert result == {}

    def test_get_baichuan_prompt_unsupported_model_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Baichuan prompt generation with unsupported model mode.

        This test verifies:
        - Proper handling of unsupported model modes
        - Default empty dict return
        """
        fake = Faker()

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_baichuan_prompt(AppMode.CHAT, "unsupported_mode", "true")

        # Assert: Verify empty dict is returned
        assert result == {}

    def test_get_prompt_all_app_modes_common_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test prompt generation for all app modes with common model.

        This test verifies:
        - All app modes work correctly with common models
        - Proper template selection for each combination
        """
        fake = Faker()

        # Test all app modes
        app_modes = [AppMode.CHAT, AppMode.COMPLETION]
        model_modes = ["completion", "chat"]

        for app_mode in app_modes:
            for model_mode in model_modes:
                args = {
                    "app_mode": app_mode,
                    "model_mode": model_mode,
                    "model_name": "gpt-3.5-turbo",
                    "has_context": "true",
                }

                # Act: Execute the method under test
                result = AdvancedPromptTemplateService.get_prompt(args)

                # Assert: Verify result is not empty
                assert result is not None
                assert result != {}

    def test_get_prompt_all_app_modes_baichuan_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test prompt generation for all app modes with Baichuan model.

        This test verifies:
        - All app modes work correctly with Baichuan models
        - Proper template selection for each combination
        """
        fake = Faker()

        # Test all app modes
        app_modes = [AppMode.CHAT, AppMode.COMPLETION]
        model_modes = ["completion", "chat"]

        for app_mode in app_modes:
            for model_mode in model_modes:
                args = {
                    "app_mode": app_mode,
                    "model_mode": model_mode,
                    "model_name": "baichuan-13b-chat",
                    "has_context": "true",
                }

                # Act: Execute the method under test
                result = AdvancedPromptTemplateService.get_prompt(args)

                # Assert: Verify result is not empty
                assert result is not None
                assert result != {}

    def test_get_prompt_edge_cases(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test prompt generation with edge cases.

        This test verifies:
        - Handling of edge case inputs
        - Proper error handling
        - Consistent behavior with unusual inputs
        """
        fake = Faker()

        # Test edge cases
        edge_cases = [
            {"app_mode": "", "model_mode": "completion", "model_name": "gpt-3.5-turbo", "has_context": "true"},
            {"app_mode": AppMode.CHAT, "model_mode": "", "model_name": "gpt-3.5-turbo", "has_context": "true"},
            {"app_mode": AppMode.CHAT, "model_mode": "completion", "model_name": "", "has_context": "true"},
            {
                "app_mode": AppMode.CHAT,
                "model_mode": "completion",
                "model_name": "gpt-3.5-turbo",
                "has_context": "",
            },
        ]

        for args in edge_cases:
            # Act: Execute the method under test
            result = AdvancedPromptTemplateService.get_prompt(args)

            # Assert: Verify method handles edge cases gracefully
            # Should either return a valid result or empty dict, but not crash
            assert result is not None

    def test_template_immutability(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test that original templates are not modified.

        This test verifies:
        - Original template constants are not modified
        - Deep copy is used properly
        - Template immutability is maintained
        """
        fake = Faker()

        # Store original templates
        original_chat_completion = copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG)
        original_chat_chat = copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG)
        original_completion_completion = copy.deepcopy(COMPLETION_APP_COMPLETION_PROMPT_CONFIG)
        original_completion_chat = copy.deepcopy(COMPLETION_APP_CHAT_PROMPT_CONFIG)

        # Test with context
        args = {
            "app_mode": AppMode.CHAT,
            "model_mode": "completion",
            "model_name": "gpt-3.5-turbo",
            "has_context": "true",
        }

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_prompt(args)

        # Assert: Verify original templates are unchanged
        assert original_chat_completion == CHAT_APP_COMPLETION_PROMPT_CONFIG
        assert original_chat_chat == CHAT_APP_CHAT_PROMPT_CONFIG
        assert original_completion_completion == COMPLETION_APP_COMPLETION_PROMPT_CONFIG
        assert original_completion_chat == COMPLETION_APP_CHAT_PROMPT_CONFIG

    def test_baichuan_template_immutability(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test that original Baichuan templates are not modified.

        This test verifies:
        - Original Baichuan template constants are not modified
        - Deep copy is used properly
        - Template immutability is maintained
        """
        fake = Faker()

        # Store original templates
        original_baichuan_chat_completion = copy.deepcopy(BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG)
        original_baichuan_chat_chat = copy.deepcopy(BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG)
        original_baichuan_completion_completion = copy.deepcopy(BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG)
        original_baichuan_completion_chat = copy.deepcopy(BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG)

        # Test with context
        args = {
            "app_mode": AppMode.CHAT,
            "model_mode": "completion",
            "model_name": "baichuan-13b-chat",
            "has_context": "true",
        }

        # Act: Execute the method under test
        result = AdvancedPromptTemplateService.get_prompt(args)

        # Assert: Verify original templates are unchanged
        assert original_baichuan_chat_completion == BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG
        assert original_baichuan_chat_chat == BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG
        assert original_baichuan_completion_completion == BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG
        assert original_baichuan_completion_chat == BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG

    def test_context_integration_consistency(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test consistency of context integration across different scenarios.

        This test verifies:
        - Context is always prepended correctly
        - Context integration is consistent across different templates
        - No context duplication or corruption
        """
        fake = Faker()

        # Test different scenarios
        test_scenarios = [
            {
                "app_mode": AppMode.CHAT,
                "model_mode": "completion",
                "model_name": "gpt-3.5-turbo",
                "has_context": "true",
            },
            {
                "app_mode": AppMode.CHAT,
                "model_mode": "chat",
                "model_name": "gpt-3.5-turbo",
                "has_context": "true",
            },
            {
                "app_mode": AppMode.COMPLETION,
                "model_mode": "completion",
                "model_name": "gpt-3.5-turbo",
                "has_context": "true",
            },
            {
                "app_mode": AppMode.COMPLETION,
                "model_mode": "chat",
                "model_name": "gpt-3.5-turbo",
                "has_context": "true",
            },
        ]

        for args in test_scenarios:
            # Act: Execute the method under test
            result = AdvancedPromptTemplateService.get_prompt(args)

            # Assert: Verify context integration is consistent
            assert result is not None
            assert result != {}

            # Check that context is properly integrated
            if "completion_prompt_config" in result:
                prompt_text = result["completion_prompt_config"]["prompt"]["text"]
                assert prompt_text.startswith(CONTEXT)
            elif "chat_prompt_config" in result:
                prompt_text = result["chat_prompt_config"]["prompt"][0]["text"]
                assert prompt_text.startswith(CONTEXT)

    def test_baichuan_context_integration_consistency(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test consistency of Baichuan context integration across different scenarios.

        This test verifies:
        - Baichuan context is always prepended correctly
        - Context integration is consistent across different templates
        - No context duplication or corruption
        """
        fake = Faker()

        # Test different scenarios
        test_scenarios = [
            {
                "app_mode": AppMode.CHAT,
                "model_mode": "completion",
                "model_name": "baichuan-13b-chat",
                "has_context": "true",
            },
            {
                "app_mode": AppMode.CHAT,
                "model_mode": "chat",
                "model_name": "baichuan-13b-chat",
                "has_context": "true",
            },
            {
                "app_mode": AppMode.COMPLETION,
                "model_mode": "completion",
                "model_name": "baichuan-13b-chat",
                "has_context": "true",
            },
            {
                "app_mode": AppMode.COMPLETION,
                "model_mode": "chat",
                "model_name": "baichuan-13b-chat",
                "has_context": "true",
            },
        ]

        for args in test_scenarios:
            # Act: Execute the method under test
            result = AdvancedPromptTemplateService.get_prompt(args)

            # Assert: Verify context integration is consistent
            assert result is not None
            assert result != {}

            # Check that Baichuan context is properly integrated
            if "completion_prompt_config" in result:
                prompt_text = result["completion_prompt_config"]["prompt"]["text"]
                assert prompt_text.startswith(BAICHUAN_CONTEXT)
            elif "chat_prompt_config" in result:
                prompt_text = result["chat_prompt_config"]["prompt"][0]["text"]
                assert prompt_text.startswith(BAICHUAN_CONTEXT)
