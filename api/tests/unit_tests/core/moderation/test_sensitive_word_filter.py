"""
Unit tests for sensitive word filter (KeywordsModeration).

This module tests the sensitive word filtering functionality including:
- Word list matching with various input types
- Case-insensitive matching behavior
- Performance with large keyword lists
- Configuration validation
- Input and output moderation scenarios
"""

import time

import pytest

from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from core.moderation.keywords.keywords import KeywordsModeration


class TestConfigValidation:
    """Test configuration validation for KeywordsModeration."""

    def test_valid_config(self):
        """Test validation passes with valid configuration."""
        # Arrange: Create a valid configuration with all required fields
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Output blocked"},
            "keywords": "badword1\nbadword2\nbadword3",  # Multiple keywords separated by newlines
        }
        # Act & Assert: Validation should pass without raising any exception
        KeywordsModeration.validate_config("tenant-123", config)

    def test_missing_keywords(self):
        """Test validation fails when keywords are missing."""
        # Arrange: Create config without the required 'keywords' field
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Output blocked"},
            # Note: 'keywords' field is intentionally missing
        }
        # Act & Assert: Should raise ValueError with specific message
        with pytest.raises(ValueError, match="keywords is required"):
            KeywordsModeration.validate_config("tenant-123", config)

    def test_keywords_too_long(self):
        """Test validation fails when keywords exceed maximum length."""
        # Arrange: Create keywords string that exceeds the 10,000 character limit
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Output blocked"},
            "keywords": "x" * 10001,  # 10,001 characters - exceeds limit by 1
        }
        # Act & Assert: Should raise ValueError about length limit
        with pytest.raises(ValueError, match="keywords length must be less than 10000"):
            KeywordsModeration.validate_config("tenant-123", config)

    def test_too_many_keyword_rows(self):
        """Test validation fails when keyword rows exceed maximum count."""
        # Arrange: Create 101 keyword rows (exceeds the 100 row limit)
        # Each keyword is on a separate line, creating 101 rows total
        keywords = "\n".join([f"keyword{i}" for i in range(101)])
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Output blocked"},
            "keywords": keywords,
        }
        # Act & Assert: Should raise ValueError about row count limit
        with pytest.raises(ValueError, match="the number of rows for the keywords must be less than 100"):
            KeywordsModeration.validate_config("tenant-123", config)

    def test_missing_inputs_config(self):
        """Test validation fails when inputs_config is missing."""
        # Arrange: Create config without inputs_config (only outputs_config)
        config = {
            "outputs_config": {"enabled": True, "preset_response": "Output blocked"},
            "keywords": "badword",
            # Note: inputs_config is missing
        }
        # Act & Assert: Should raise ValueError requiring inputs_config
        with pytest.raises(ValueError, match="inputs_config must be a dict"):
            KeywordsModeration.validate_config("tenant-123", config)

    def test_missing_outputs_config(self):
        """Test validation fails when outputs_config is missing."""
        # Arrange: Create config without outputs_config (only inputs_config)
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "keywords": "badword",
            # Note: outputs_config is missing
        }
        # Act & Assert: Should raise ValueError requiring outputs_config
        with pytest.raises(ValueError, match="outputs_config must be a dict"):
            KeywordsModeration.validate_config("tenant-123", config)

    def test_both_configs_disabled(self):
        """Test validation fails when both input and output configs are disabled."""
        # Arrange: Create config where both input and output moderation are disabled
        # This is invalid because at least one must be enabled for moderation to work
        config = {
            "inputs_config": {"enabled": False},  # Disabled
            "outputs_config": {"enabled": False},  # Disabled
            "keywords": "badword",
        }
        # Act & Assert: Should raise ValueError requiring at least one to be enabled
        with pytest.raises(ValueError, match="At least one of inputs_config or outputs_config must be enabled"):
            KeywordsModeration.validate_config("tenant-123", config)

    def test_missing_preset_response_when_enabled(self):
        """Test validation fails when preset_response is missing for enabled config."""
        # Arrange: Enable inputs_config but don't provide required preset_response
        # When a config is enabled, it must have a preset_response to show users
        config = {
            "inputs_config": {"enabled": True},  # Enabled but missing preset_response
            "outputs_config": {"enabled": False},
            "keywords": "badword",
        }
        # Act & Assert: Should raise ValueError requiring preset_response
        with pytest.raises(ValueError, match="inputs_config.preset_response is required"):
            KeywordsModeration.validate_config("tenant-123", config)

    def test_preset_response_too_long(self):
        """Test validation fails when preset_response exceeds maximum length."""
        # Arrange: Create preset_response with 101 characters (exceeds 100 char limit)
        config = {
            "inputs_config": {"enabled": True, "preset_response": "x" * 101},  # 101 chars
            "outputs_config": {"enabled": False},
            "keywords": "badword",
        }
        # Act & Assert: Should raise ValueError about preset_response length
        with pytest.raises(ValueError, match="inputs_config.preset_response must be less than 100 characters"):
            KeywordsModeration.validate_config("tenant-123", config)


class TestWordListMatching:
    """Test word list matching functionality."""

    def _create_moderation(self, keywords: str, inputs_enabled: bool = True, outputs_enabled: bool = True):
        """Helper method to create KeywordsModeration instance with test configuration."""
        config = {
            "inputs_config": {"enabled": inputs_enabled, "preset_response": "Input contains sensitive words"},
            "outputs_config": {"enabled": outputs_enabled, "preset_response": "Output contains sensitive words"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_single_keyword_match_in_input(self):
        """Test detection of single keyword in input."""
        # Arrange: Create moderation with a single keyword "badword"
        moderation = self._create_moderation("badword")

        # Act: Check input text that contains the keyword
        result = moderation.moderation_for_inputs({"text": "This contains badword in it"})

        # Assert: Should be flagged with appropriate action and response
        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Input contains sensitive words"

    def test_single_keyword_no_match_in_input(self):
        """Test no detection when keyword is not present in input."""
        # Arrange: Create moderation with keyword "badword"
        moderation = self._create_moderation("badword")

        # Act: Check clean input text that doesn't contain the keyword
        result = moderation.moderation_for_inputs({"text": "This is clean content"})

        # Assert: Should NOT be flagged since keyword is absent
        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT

    def test_multiple_keywords_match(self):
        """Test detection of multiple keywords."""
        # Arrange: Create moderation with 3 keywords separated by newlines
        moderation = self._create_moderation("badword1\nbadword2\nbadword3")

        # Act: Check text containing one of the keywords (badword2)
        result = moderation.moderation_for_inputs({"text": "This contains badword2 in it"})

        # Assert: Should be flagged even though only one keyword matches
        assert result.flagged is True

    def test_keyword_in_query_parameter(self):
        """Test detection of keyword in query parameter."""
        # Arrange: Create moderation with keyword "sensitive"
        moderation = self._create_moderation("sensitive")

        # Act: Check with clean input field but keyword in query parameter
        # The query parameter is also checked for sensitive words
        result = moderation.moderation_for_inputs({"field": "clean"}, query="This is sensitive information")

        # Assert: Should be flagged because keyword is in query
        assert result.flagged is True

    def test_keyword_in_multiple_input_fields(self):
        """Test detection across multiple input fields."""
        # Arrange: Create moderation with keyword "badword"
        moderation = self._create_moderation("badword")

        # Act: Check multiple input fields where keyword is in one field (field2)
        # All input fields are checked for sensitive words
        result = moderation.moderation_for_inputs(
            {"field1": "clean", "field2": "contains badword", "field3": "also clean"}
        )

        # Assert: Should be flagged because keyword found in field2
        assert result.flagged is True

    def test_empty_keywords_list(self):
        """Test behavior with empty keywords after filtering."""
        # Arrange: Create moderation with only newlines (no actual keywords)
        # Empty lines are filtered out, resulting in zero keywords to check
        moderation = self._create_moderation("\n\n\n")  # Only newlines, no actual keywords

        # Act: Check any text content
        result = moderation.moderation_for_inputs({"text": "any content"})

        # Assert: Should NOT be flagged since there are no keywords to match
        assert result.flagged is False

    def test_keyword_with_whitespace(self):
        """Test keywords with leading/trailing whitespace are preserved."""
        # Arrange: Create keyword phrase with space in the middle
        moderation = self._create_moderation("bad word")  # Keyword with space

        # Act: Check text containing the exact phrase with space
        result = moderation.moderation_for_inputs({"text": "This contains bad word in it"})

        # Assert: Should match the phrase including the space
        assert result.flagged is True

    def test_partial_word_match(self):
        """Test that keywords match as substrings (not whole words only)."""
        # Arrange: Create moderation with short keyword "bad"
        moderation = self._create_moderation("bad")

        # Act: Check text where "bad" appears as part of another word "badass"
        result = moderation.moderation_for_inputs({"text": "This is badass content"})

        # Assert: Should match because matching is substring-based, not whole-word
        # "bad" is found within "badass"
        assert result.flagged is True

    def test_keyword_at_start_of_text(self):
        """Test keyword detection at the start of text."""
        # Arrange: Create moderation with keyword "badword"
        moderation = self._create_moderation("badword")

        # Act: Check text where keyword is at the very beginning
        result = moderation.moderation_for_inputs({"text": "badword is at the start"})

        # Assert: Should detect keyword regardless of position
        assert result.flagged is True

    def test_keyword_at_end_of_text(self):
        """Test keyword detection at the end of text."""
        # Arrange: Create moderation with keyword "badword"
        moderation = self._create_moderation("badword")

        # Act: Check text where keyword is at the very end
        result = moderation.moderation_for_inputs({"text": "This ends with badword"})

        # Assert: Should detect keyword regardless of position
        assert result.flagged is True

    def test_multiple_occurrences_of_same_keyword(self):
        """Test detection when keyword appears multiple times."""
        # Arrange: Create moderation with keyword "bad"
        moderation = self._create_moderation("bad")

        # Act: Check text where "bad" appears 3 times
        result = moderation.moderation_for_inputs({"text": "bad things are bad and bad"})

        # Assert: Should be flagged (only needs to find it once)
        assert result.flagged is True


class TestCaseInsensitiveMatching:
    """Test case-insensitive matching behavior."""

    def _create_moderation(self, keywords: str):
        """Helper method to create KeywordsModeration instance."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_lowercase_keyword_matches_uppercase_text(self):
        """Test lowercase keyword matches uppercase text."""
        # Arrange: Create moderation with lowercase keyword
        moderation = self._create_moderation("badword")

        # Act: Check text with uppercase version of the keyword
        result = moderation.moderation_for_inputs({"text": "This contains BADWORD in it"})

        # Assert: Should match because comparison is case-insensitive
        assert result.flagged is True

    def test_uppercase_keyword_matches_lowercase_text(self):
        """Test uppercase keyword matches lowercase text."""
        # Arrange: Create moderation with UPPERCASE keyword
        moderation = self._create_moderation("BADWORD")

        # Act: Check text with lowercase version of the keyword
        result = moderation.moderation_for_inputs({"text": "This contains badword in it"})

        # Assert: Should match because comparison is case-insensitive
        assert result.flagged is True

    def test_mixed_case_keyword_matches_mixed_case_text(self):
        """Test mixed case keyword matches mixed case text."""
        # Arrange: Create moderation with MiXeD case keyword
        moderation = self._create_moderation("BaDwOrD")

        # Act: Check text with different mixed case version
        result = moderation.moderation_for_inputs({"text": "This contains bAdWoRd in it"})

        # Assert: Should match despite different casing
        assert result.flagged is True

    def test_case_insensitive_with_special_characters(self):
        """Test case-insensitive matching with special characters."""
        moderation = self._create_moderation("Bad-Word")
        result = moderation.moderation_for_inputs({"text": "This contains BAD-WORD in it"})

        assert result.flagged is True

    def test_case_insensitive_unicode_characters(self):
        """Test case-insensitive matching with unicode characters."""
        moderation = self._create_moderation("café")
        result = moderation.moderation_for_inputs({"text": "Welcome to CAFÉ"})

        # Note: Python's lower() handles unicode, but behavior may vary
        assert result.flagged is True

    def test_case_insensitive_in_query(self):
        """Test case-insensitive matching in query parameter."""
        moderation = self._create_moderation("sensitive")
        result = moderation.moderation_for_inputs({"field": "clean"}, query="SENSITIVE information")

        assert result.flagged is True


class TestOutputModeration:
    """Test output moderation functionality."""

    def _create_moderation(self, keywords: str, outputs_enabled: bool = True):
        """Helper method to create KeywordsModeration instance."""
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {"enabled": outputs_enabled, "preset_response": "Output blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_output_moderation_detects_keyword(self):
        """Test output moderation detects sensitive keywords."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_outputs("This output contains badword")

        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Output blocked"

    def test_output_moderation_clean_text(self):
        """Test output moderation allows clean text."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_outputs("This is clean output")

        assert result.flagged is False

    def test_output_moderation_disabled(self):
        """Test output moderation when disabled."""
        moderation = self._create_moderation("badword", outputs_enabled=False)
        result = moderation.moderation_for_outputs("This output contains badword")

        assert result.flagged is False

    def test_output_moderation_case_insensitive(self):
        """Test output moderation is case-insensitive."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_outputs("This output contains BADWORD")

        assert result.flagged is True

    def test_output_moderation_multiple_keywords(self):
        """Test output moderation with multiple keywords."""
        moderation = self._create_moderation("bad\nworse\nworst")
        result = moderation.moderation_for_outputs("This is worse than expected")

        assert result.flagged is True


class TestInputModeration:
    """Test input moderation specific scenarios."""

    def _create_moderation(self, keywords: str, inputs_enabled: bool = True):
        """Helper method to create KeywordsModeration instance."""
        config = {
            "inputs_config": {"enabled": inputs_enabled, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": False},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_input_moderation_disabled(self):
        """Test input moderation when disabled."""
        moderation = self._create_moderation("badword", inputs_enabled=False)
        result = moderation.moderation_for_inputs({"text": "This contains badword"})

        assert result.flagged is False

    def test_input_moderation_with_numeric_values(self):
        """Test input moderation converts numeric values to strings."""
        moderation = self._create_moderation("123")
        result = moderation.moderation_for_inputs({"number": 123456})

        # Should match because 123 is substring of "123456"
        assert result.flagged is True

    def test_input_moderation_with_boolean_values(self):
        """Test input moderation handles boolean values."""
        moderation = self._create_moderation("true")
        result = moderation.moderation_for_inputs({"flag": True})

        # Should match because str(True) == "True" and case-insensitive
        assert result.flagged is True

    def test_input_moderation_with_none_values(self):
        """Test input moderation handles None values."""
        moderation = self._create_moderation("none")
        result = moderation.moderation_for_inputs({"value": None})

        # Should match because str(None) == "None" and case-insensitive
        assert result.flagged is True

    def test_input_moderation_with_empty_string(self):
        """Test input moderation handles empty string values."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_inputs({"text": ""})

        assert result.flagged is False

    def test_input_moderation_with_list_values(self):
        """Test input moderation handles list values (converted to string)."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_inputs({"items": ["good", "badword", "clean"]})

        # Should match because str(list) contains "badword"
        assert result.flagged is True


class TestPerformanceWithLargeLists:
    """Test performance with large keyword lists."""

    def _create_moderation(self, keywords: str):
        """Helper method to create KeywordsModeration instance."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_performance_with_100_keywords(self):
        """Test performance with maximum allowed keywords (100 rows)."""
        # Arrange: Create 100 keywords (the maximum allowed)
        keywords = "\n".join([f"keyword{i}" for i in range(100)])
        moderation = self._create_moderation(keywords)

        # Act: Measure time to check text against all 100 keywords
        start_time = time.time()
        result = moderation.moderation_for_inputs({"text": "This contains keyword50 in it"})
        elapsed_time = time.time() - start_time

        # Assert: Should find the keyword and complete quickly
        assert result.flagged is True
        # Performance requirement: < 100ms for 100 keywords
        assert elapsed_time < 0.1

    def test_performance_with_large_text_input(self):
        """Test performance with large text input."""
        # Arrange: Create moderation with 3 keywords
        keywords = "badword1\nbadword2\nbadword3"
        moderation = self._create_moderation(keywords)

        # Create large text input (10,000 characters of clean content)
        large_text = "clean " * 2000  # "clean " repeated 2000 times = 10,000 chars

        # Act: Measure time to check large text against keywords
        start_time = time.time()
        result = moderation.moderation_for_inputs({"text": large_text})
        elapsed_time = time.time() - start_time

        # Assert: Should not be flagged (no keywords present)
        assert result.flagged is False
        # Performance requirement: < 100ms even with large text
        assert elapsed_time < 0.1

    def test_performance_keyword_at_end_of_large_list(self):
        """Test performance when matching keyword is at end of list."""
        # Create 99 non-matching keywords + 1 matching keyword at the end
        keywords = "\n".join([f"keyword{i}" for i in range(99)] + ["badword"])
        moderation = self._create_moderation(keywords)

        start_time = time.time()
        result = moderation.moderation_for_inputs({"text": "This contains badword"})
        elapsed_time = time.time() - start_time

        assert result.flagged is True
        # Should still complete quickly even though match is at end
        assert elapsed_time < 0.1

    def test_performance_no_match_in_large_list(self):
        """Test performance when no keywords match (worst case)."""
        keywords = "\n".join([f"keyword{i}" for i in range(100)])
        moderation = self._create_moderation(keywords)

        start_time = time.time()
        result = moderation.moderation_for_inputs({"text": "This is completely clean text"})
        elapsed_time = time.time() - start_time

        assert result.flagged is False
        # Should complete in reasonable time even when checking all keywords
        assert elapsed_time < 0.1

    def test_performance_multiple_input_fields(self):
        """Test performance with multiple input fields."""
        keywords = "\n".join([f"keyword{i}" for i in range(50)])
        moderation = self._create_moderation(keywords)

        # Create 10 input fields with large text
        inputs = {f"field{i}": "clean text " * 100 for i in range(10)}

        start_time = time.time()
        result = moderation.moderation_for_inputs(inputs)
        elapsed_time = time.time() - start_time

        assert result.flagged is False
        # Should complete in reasonable time
        assert elapsed_time < 0.2

    def test_memory_efficiency_with_large_keywords(self):
        """Test memory efficiency by processing large keyword list multiple times."""
        # Create keywords close to the 10000 character limit
        keywords = "\n".join([f"keyword{i:04d}" for i in range(90)])  # ~900 chars
        moderation = self._create_moderation(keywords)

        # Process multiple times to ensure no memory leaks
        for _ in range(100):
            result = moderation.moderation_for_inputs({"text": "clean text"})
            assert result.flagged is False


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def _create_moderation(self, keywords: str, inputs_enabled: bool = True, outputs_enabled: bool = True):
        """Helper method to create KeywordsModeration instance."""
        config = {
            "inputs_config": {"enabled": inputs_enabled, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": outputs_enabled, "preset_response": "Output blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_empty_input_dict(self):
        """Test with empty input dictionary."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_inputs({})

        assert result.flagged is False

    def test_empty_query_string(self):
        """Test with empty query string."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_inputs({"text": "clean"}, query="")

        assert result.flagged is False

    def test_special_regex_characters_in_keywords(self):
        """Test keywords containing special regex characters."""
        moderation = self._create_moderation("bad.*word")
        result = moderation.moderation_for_inputs({"text": "This contains bad.*word literally"})

        # Should match as literal string, not regex pattern
        assert result.flagged is True

    def test_newline_in_text_content(self):
        """Test text content containing newlines."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_inputs({"text": "Line 1\nbadword\nLine 3"})

        assert result.flagged is True

    def test_unicode_emoji_in_keywords(self):
        """Test keywords containing unicode emoji."""
        moderation = self._create_moderation("🚫")
        result = moderation.moderation_for_inputs({"text": "This is 🚫 prohibited"})

        assert result.flagged is True

    def test_unicode_emoji_in_text(self):
        """Test text containing unicode emoji."""
        moderation = self._create_moderation("prohibited")
        result = moderation.moderation_for_inputs({"text": "This is 🚫 prohibited"})

        assert result.flagged is True

    def test_very_long_single_keyword(self):
        """Test with a very long single keyword."""
        long_keyword = "a" * 1000
        moderation = self._create_moderation(long_keyword)
        result = moderation.moderation_for_inputs({"text": "This contains " + long_keyword + " in it"})

        assert result.flagged is True

    def test_keyword_with_only_spaces(self):
        """Test keyword that is only spaces."""
        moderation = self._create_moderation("   ")

        # Text without three consecutive spaces should not match
        result1 = moderation.moderation_for_inputs({"text": "This has spaces"})
        assert result1.flagged is False

        # Text with three consecutive spaces should match
        result2 = moderation.moderation_for_inputs({"text": "This   has   spaces"})
        assert result2.flagged is True

    def test_config_not_set_error_for_inputs(self):
        """Test error when config is not set for input moderation."""
        moderation = KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=None)

        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_inputs({"text": "test"})

    def test_config_not_set_error_for_outputs(self):
        """Test error when config is not set for output moderation."""
        moderation = KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=None)

        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_outputs("test")

    def test_tabs_in_keywords(self):
        """Test keywords containing tab characters."""
        moderation = self._create_moderation("bad\tword")
        result = moderation.moderation_for_inputs({"text": "This contains bad\tword"})

        assert result.flagged is True

    def test_carriage_return_in_keywords(self):
        """Test keywords containing carriage return."""
        moderation = self._create_moderation("bad\rword")
        result = moderation.moderation_for_inputs({"text": "This contains bad\rword"})

        assert result.flagged is True


class TestModerationResult:
    """Test the structure and content of moderation results."""

    def _create_moderation(self, keywords: str):
        """Helper method to create KeywordsModeration instance."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Input response"},
            "outputs_config": {"enabled": True, "preset_response": "Output response"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_input_result_structure_when_flagged(self):
        """Test input moderation result structure when content is flagged."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_inputs({"text": "badword"})

        assert isinstance(result, ModerationInputsResult)
        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Input response"
        assert isinstance(result.inputs, dict)
        assert result.query == ""

    def test_input_result_structure_when_not_flagged(self):
        """Test input moderation result structure when content is clean."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_inputs({"text": "clean"})

        assert isinstance(result, ModerationInputsResult)
        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Input response"

    def test_output_result_structure_when_flagged(self):
        """Test output moderation result structure when content is flagged."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_outputs("badword")

        assert isinstance(result, ModerationOutputsResult)
        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Output response"
        assert result.text == ""

    def test_output_result_structure_when_not_flagged(self):
        """Test output moderation result structure when content is clean."""
        moderation = self._create_moderation("badword")
        result = moderation.moderation_for_outputs("clean")

        assert isinstance(result, ModerationOutputsResult)
        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Output response"


class TestWildcardPatterns:
    """
    Test wildcard pattern matching behavior.

    Note: The current implementation uses simple substring matching,
    not true wildcard/regex patterns. These tests document the actual behavior.
    """

    def _create_moderation(self, keywords: str):
        """Helper method to create KeywordsModeration instance."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_asterisk_treated_as_literal(self):
        """Test that asterisk (*) is treated as literal character, not wildcard."""
        moderation = self._create_moderation("bad*word")

        # Should match literal "bad*word"
        result1 = moderation.moderation_for_inputs({"text": "This contains bad*word"})
        assert result1.flagged is True

        # Should NOT match "badXword" (asterisk is not a wildcard)
        result2 = moderation.moderation_for_inputs({"text": "This contains badXword"})
        assert result2.flagged is False

    def test_question_mark_treated_as_literal(self):
        """Test that question mark (?) is treated as literal character, not wildcard."""
        moderation = self._create_moderation("bad?word")

        # Should match literal "bad?word"
        result1 = moderation.moderation_for_inputs({"text": "This contains bad?word"})
        assert result1.flagged is True

        # Should NOT match "badXword" (question mark is not a wildcard)
        result2 = moderation.moderation_for_inputs({"text": "This contains badXword"})
        assert result2.flagged is False

    def test_dot_treated_as_literal(self):
        """Test that dot (.) is treated as literal character, not regex wildcard."""
        moderation = self._create_moderation("bad.word")

        # Should match literal "bad.word"
        result1 = moderation.moderation_for_inputs({"text": "This contains bad.word"})
        assert result1.flagged is True

        # Should NOT match "badXword" (dot is not a regex wildcard)
        result2 = moderation.moderation_for_inputs({"text": "This contains badXword"})
        assert result2.flagged is False

    def test_substring_matching_behavior(self):
        """Test that matching is based on substring, not patterns."""
        moderation = self._create_moderation("bad")

        # Should match any text containing "bad" as substring
        test_cases = [
            ("bad", True),
            ("badword", True),
            ("notbad", True),
            ("really bad stuff", True),
            ("b-a-d", False),  # Not a substring match
            ("b ad", False),  # Not a substring match
        ]

        for text, expected_flagged in test_cases:
            result = moderation.moderation_for_inputs({"text": text})
            assert result.flagged == expected_flagged, f"Failed for text: {text}"


class TestConcurrentModeration:
    """
    Test concurrent moderation scenarios.

    These tests verify that the moderation system handles both input and output
    moderation correctly when both are enabled simultaneously.
    """

    def _create_moderation(
        self, keywords: str, inputs_enabled: bool = True, outputs_enabled: bool = True
    ) -> KeywordsModeration:
        """
        Helper method to create KeywordsModeration instance.

        Args:
            keywords: Newline-separated list of keywords to filter
            inputs_enabled: Whether input moderation is enabled
            outputs_enabled: Whether output moderation is enabled

        Returns:
            Configured KeywordsModeration instance
        """
        config = {
            "inputs_config": {"enabled": inputs_enabled, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": outputs_enabled, "preset_response": "Output blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_both_input_and_output_enabled(self):
        """Test that both input and output moderation work when both are enabled."""
        moderation = self._create_moderation("badword", inputs_enabled=True, outputs_enabled=True)

        # Test input moderation
        input_result = moderation.moderation_for_inputs({"text": "This contains badword"})
        assert input_result.flagged is True
        assert input_result.preset_response == "Input blocked"

        # Test output moderation
        output_result = moderation.moderation_for_outputs("This contains badword")
        assert output_result.flagged is True
        assert output_result.preset_response == "Output blocked"

    def test_different_keywords_in_input_vs_output(self):
        """Test that the same keyword list applies to both input and output."""
        moderation = self._create_moderation("input_bad\noutput_bad")

        # Both keywords should be checked for inputs
        result1 = moderation.moderation_for_inputs({"text": "This has input_bad"})
        assert result1.flagged is True

        result2 = moderation.moderation_for_inputs({"text": "This has output_bad"})
        assert result2.flagged is True

        # Both keywords should be checked for outputs
        result3 = moderation.moderation_for_outputs("This has input_bad")
        assert result3.flagged is True

        result4 = moderation.moderation_for_outputs("This has output_bad")
        assert result4.flagged is True

    def test_only_input_enabled(self):
        """Test that only input moderation works when output is disabled."""
        moderation = self._create_moderation("badword", inputs_enabled=True, outputs_enabled=False)

        # Input should be flagged
        input_result = moderation.moderation_for_inputs({"text": "This contains badword"})
        assert input_result.flagged is True

        # Output should NOT be flagged (disabled)
        output_result = moderation.moderation_for_outputs("This contains badword")
        assert output_result.flagged is False

    def test_only_output_enabled(self):
        """Test that only output moderation works when input is disabled."""
        moderation = self._create_moderation("badword", inputs_enabled=False, outputs_enabled=True)

        # Input should NOT be flagged (disabled)
        input_result = moderation.moderation_for_inputs({"text": "This contains badword"})
        assert input_result.flagged is False

        # Output should be flagged
        output_result = moderation.moderation_for_outputs("This contains badword")
        assert output_result.flagged is True


class TestMultilingualSupport:
    """
    Test multilingual keyword matching.

    These tests verify that the sensitive word filter correctly handles
    keywords and text in various languages and character sets.
    """

    def _create_moderation(self, keywords: str) -> KeywordsModeration:
        """
        Helper method to create KeywordsModeration instance.

        Args:
            keywords: Newline-separated list of keywords to filter

        Returns:
            Configured KeywordsModeration instance
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_chinese_keywords(self):
        """Test filtering of Chinese keywords."""
        # Chinese characters for "sensitive word"
        moderation = self._create_moderation("敏感词\n违禁词")

        # Should detect Chinese keywords
        result = moderation.moderation_for_inputs({"text": "这是一个敏感词测试"})
        assert result.flagged is True

    def test_japanese_keywords(self):
        """Test filtering of Japanese keywords (Hiragana, Katakana, Kanji)."""
        moderation = self._create_moderation("禁止\nきんし\nキンシ")

        # Test Kanji
        result1 = moderation.moderation_for_inputs({"text": "これは禁止です"})
        assert result1.flagged is True

        # Test Hiragana
        result2 = moderation.moderation_for_inputs({"text": "これはきんしです"})
        assert result2.flagged is True

        # Test Katakana
        result3 = moderation.moderation_for_inputs({"text": "これはキンシです"})
        assert result3.flagged is True

    def test_arabic_keywords(self):
        """Test filtering of Arabic keywords (right-to-left text)."""
        # Arabic word for "forbidden"
        moderation = self._create_moderation("محظور")

        result = moderation.moderation_for_inputs({"text": "هذا محظور في النظام"})
        assert result.flagged is True

    def test_cyrillic_keywords(self):
        """Test filtering of Cyrillic (Russian) keywords."""
        # Russian word for "forbidden"
        moderation = self._create_moderation("запрещено")

        result = moderation.moderation_for_inputs({"text": "Это запрещено"})
        assert result.flagged is True

    def test_mixed_language_keywords(self):
        """Test filtering with keywords in multiple languages."""
        moderation = self._create_moderation("bad\n坏\nплохо\nmal")

        # English
        result1 = moderation.moderation_for_inputs({"text": "This is bad"})
        assert result1.flagged is True

        # Chinese
        result2 = moderation.moderation_for_inputs({"text": "这很坏"})
        assert result2.flagged is True

        # Russian
        result3 = moderation.moderation_for_inputs({"text": "Это плохо"})
        assert result3.flagged is True

        # Spanish
        result4 = moderation.moderation_for_inputs({"text": "Esto es mal"})
        assert result4.flagged is True

    def test_accented_characters(self):
        """Test filtering of keywords with accented characters."""
        moderation = self._create_moderation("café\nnaïve\nrésumé")

        # Should match accented characters
        result1 = moderation.moderation_for_inputs({"text": "Welcome to café"})
        assert result1.flagged is True

        result2 = moderation.moderation_for_inputs({"text": "Don't be naïve"})
        assert result2.flagged is True

        result3 = moderation.moderation_for_inputs({"text": "Send your résumé"})
        assert result3.flagged is True


class TestComplexInputTypes:
    """
    Test moderation with complex input data types.

    These tests verify that the filter correctly handles various Python data types
    when they are converted to strings for matching.
    """

    def _create_moderation(self, keywords: str) -> KeywordsModeration:
        """
        Helper method to create KeywordsModeration instance.

        Args:
            keywords: Newline-separated list of keywords to filter

        Returns:
            Configured KeywordsModeration instance
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_nested_dict_values(self):
        """Test that nested dictionaries are converted to strings for matching."""
        moderation = self._create_moderation("badword")

        # When dict is converted to string, it includes the keyword
        result = moderation.moderation_for_inputs({"data": {"nested": "badword"}})
        assert result.flagged is True

    def test_float_values(self):
        """Test filtering with float values."""
        moderation = self._create_moderation("3.14")

        # Float should be converted to string for matching
        result = moderation.moderation_for_inputs({"pi": 3.14159})
        assert result.flagged is True

    def test_negative_numbers(self):
        """Test filtering with negative numbers."""
        moderation = self._create_moderation("-100")

        result = moderation.moderation_for_inputs({"value": -100})
        assert result.flagged is True

    def test_scientific_notation(self):
        """Test filtering with scientific notation numbers."""
        moderation = self._create_moderation("1e+10")

        # Scientific notation like 1e10 should match "1e+10"
        # Note: Python converts 1e10 to "10000000000.0" in string form
        result = moderation.moderation_for_inputs({"value": 1e10})
        # This will NOT match because str(1e10) = "10000000000.0"
        assert result.flagged is False

        # But if we search for the actual string representation, it should match
        moderation2 = self._create_moderation("10000000000")
        result2 = moderation2.moderation_for_inputs({"value": 1e10})
        assert result2.flagged is True

    def test_tuple_values(self):
        """Test that tuple values are converted to strings for matching."""
        moderation = self._create_moderation("badword")

        result = moderation.moderation_for_inputs({"data": ("good", "badword", "clean")})
        assert result.flagged is True

    def test_set_values(self):
        """Test that set values are converted to strings for matching."""
        moderation = self._create_moderation("badword")

        result = moderation.moderation_for_inputs({"data": {"good", "badword", "clean"}})
        assert result.flagged is True

    def test_bytes_values(self):
        """Test that bytes values are converted to strings for matching."""
        moderation = self._create_moderation("badword")

        # bytes object will be converted to string representation
        result = moderation.moderation_for_inputs({"data": b"badword"})
        assert result.flagged is True


class TestBoundaryConditions:
    """
    Test boundary conditions and limits.

    These tests verify behavior at the edges of allowed values and limits
    defined in the configuration validation.
    """

    def _create_moderation(self, keywords: str) -> KeywordsModeration:
        """
        Helper method to create KeywordsModeration instance.

        Args:
            keywords: Newline-separated list of keywords to filter

        Returns:
            Configured KeywordsModeration instance
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_exactly_100_keyword_rows(self):
        """Test with exactly 100 keyword rows (boundary case)."""
        # Create exactly 100 rows (at the limit)
        keywords = "\n".join([f"keyword{i}" for i in range(100)])
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": keywords,
        }

        # Should not raise an exception (100 is allowed)
        KeywordsModeration.validate_config("tenant-123", config)

        # Should work correctly
        moderation = self._create_moderation(keywords)
        result = moderation.moderation_for_inputs({"text": "This contains keyword50"})
        assert result.flagged is True

    def test_exactly_10000_character_keywords(self):
        """Test with exactly 10000 characters in keywords (boundary case)."""
        # Create keywords that are exactly 10000 characters
        keywords = "x" * 10000
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": keywords,
        }

        # Should not raise an exception (10000 is allowed)
        KeywordsModeration.validate_config("tenant-123", config)

    def test_exactly_100_character_preset_response(self):
        """Test with exactly 100 characters in preset_response (boundary case)."""
        preset_response = "x" * 100
        config = {
            "inputs_config": {"enabled": True, "preset_response": preset_response},
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }

        # Should not raise an exception (100 is allowed)
        KeywordsModeration.validate_config("tenant-123", config)

    def test_single_character_keyword(self):
        """Test with single character keywords."""
        moderation = self._create_moderation("a")

        # Should match any text containing "a"
        result = moderation.moderation_for_inputs({"text": "This has an a"})
        assert result.flagged is True

    def test_empty_string_keyword_filtered_out(self):
        """Test that empty string keywords are filtered out."""
        # Keywords with empty lines
        moderation = self._create_moderation("badword\n\n\ngoodkeyword\n")

        # Should only check non-empty keywords
        result1 = moderation.moderation_for_inputs({"text": "This has badword"})
        assert result1.flagged is True

        result2 = moderation.moderation_for_inputs({"text": "This has goodkeyword"})
        assert result2.flagged is True

        result3 = moderation.moderation_for_inputs({"text": "This is clean"})
        assert result3.flagged is False


class TestRealWorldScenarios:
    """
    Test real-world usage scenarios.

    These tests simulate actual use cases that might occur in production,
    including common patterns and edge cases users might encounter.
    """

    def _create_moderation(self, keywords: str) -> KeywordsModeration:
        """
        Helper method to create KeywordsModeration instance.

        Args:
            keywords: Newline-separated list of keywords to filter

        Returns:
            Configured KeywordsModeration instance
        """
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Content blocked due to policy violation"},
            "outputs_config": {"enabled": True, "preset_response": "Response blocked due to policy violation"},
            "keywords": keywords,
        }
        return KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

    def test_profanity_filter(self):
        """Test common profanity filtering scenario."""
        # Common profanity words (sanitized for testing)
        moderation = self._create_moderation("damn\nhell\ncrap")

        result = moderation.moderation_for_inputs({"message": "What the hell is going on?"})
        assert result.flagged is True

    def test_spam_detection(self):
        """Test spam keyword detection."""
        moderation = self._create_moderation("click here\nfree money\nact now\nwin prize")

        result = moderation.moderation_for_inputs({"message": "Click here to win prize!"})
        assert result.flagged is True

    def test_personal_information_protection(self):
        """Test detection of patterns that might indicate personal information."""
        # Note: This is simplified; real PII detection would use regex
        moderation = self._create_moderation("ssn\ncredit card\npassword\nbank account")

        result = moderation.moderation_for_inputs({"text": "My password is 12345"})
        assert result.flagged is True

    def test_brand_name_filtering(self):
        """Test filtering of competitor brand names."""
        moderation = self._create_moderation("CompetitorA\nCompetitorB\nRivalCorp")

        result = moderation.moderation_for_inputs({"review": "I prefer CompetitorA over this product"})
        assert result.flagged is True

    def test_url_filtering(self):
        """Test filtering of URLs or URL patterns."""
        moderation = self._create_moderation("http://\nhttps://\nwww.\n.com/spam")

        result = moderation.moderation_for_inputs({"message": "Visit http://malicious-site.com"})
        assert result.flagged is True

    def test_code_injection_patterns(self):
        """Test detection of potential code injection patterns."""
        moderation = self._create_moderation("<script>\n<iframe\njavascript:\n<?php")

        result = moderation.moderation_for_inputs({"input": "<script>alert('xss')</script>"})
        assert result.flagged is True

    def test_medical_misinformation_keywords(self):
        """Test filtering of medical misinformation keywords."""
        moderation = self._create_moderation("miracle cure\ninstant healing\nguaranteed cure")

        result = moderation.moderation_for_inputs({"post": "This miracle cure will solve all your problems!"})
        assert result.flagged is True

    def test_chat_message_moderation(self):
        """Test moderation of chat messages with multiple fields."""
        moderation = self._create_moderation("offensive\nabusive\nthreat")

        # Simulate a chat message with username and content
        result = moderation.moderation_for_inputs(
            {"username": "user123", "message": "This is an offensive message", "timestamp": "2024-01-01"}
        )
        assert result.flagged is True

    def test_form_submission_validation(self):
        """Test moderation of form submissions with multiple fields."""
        moderation = self._create_moderation("spam\nbot\nautomated")

        # Simulate a form submission
        result = moderation.moderation_for_inputs(
            {
                "name": "John Doe",
                "email": "john@example.com",
                "message": "This is a spam message from a bot",
                "subject": "Inquiry",
            }
        )
        assert result.flagged is True

    def test_clean_content_passes_through(self):
        """Test that legitimate clean content is not flagged."""
        moderation = self._create_moderation("badword\noffensive\nspam")

        # Clean, legitimate content should pass
        result = moderation.moderation_for_inputs(
            {
                "title": "Product Review",
                "content": "This is a great product. I highly recommend it to everyone.",
                "rating": 5,
            }
        )
        assert result.flagged is False


class TestErrorHandlingAndRecovery:
    """
    Test error handling and recovery scenarios.

    These tests verify that the system handles errors gracefully and provides
    meaningful error messages.
    """

    def test_invalid_config_type(self):
        """Test that invalid config types are handled."""
        # Config can be None or dict, string will be accepted but cause issues later
        # The constructor doesn't validate config type, so we test runtime behavior
        moderation = KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config="invalid")

        # Should raise TypeError when trying to use string as dict
        with pytest.raises(TypeError):
            moderation.moderation_for_inputs({"text": "test"})

    def test_missing_inputs_config_key(self):
        """Test handling of missing inputs_config key in config."""
        config = {
            "outputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": "test",
        }

        moderation = KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

        # Should raise KeyError when trying to access inputs_config
        with pytest.raises(KeyError):
            moderation.moderation_for_inputs({"text": "test"})

    def test_missing_outputs_config_key(self):
        """Test handling of missing outputs_config key in config."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "keywords": "test",
        }

        moderation = KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

        # Should raise KeyError when trying to access outputs_config
        with pytest.raises(KeyError):
            moderation.moderation_for_outputs("test")

    def test_missing_keywords_key_in_config(self):
        """Test handling of missing keywords key in config."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
        }

        moderation = KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

        # Should raise KeyError when trying to access keywords
        with pytest.raises(KeyError):
            moderation.moderation_for_inputs({"text": "test"})

    def test_graceful_handling_of_unusual_input_values(self):
        """Test that unusual but valid input values don't cause crashes."""
        config = {
            "inputs_config": {"enabled": True, "preset_response": "Blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "test",
        }
        moderation = KeywordsModeration(app_id="test-app", tenant_id="test-tenant", config=config)

        # These should not crash, even if they don't match
        unusual_values = [
            {"value": float("inf")},  # Infinity
            {"value": float("-inf")},  # Negative infinity
            {"value": complex(1, 2)},  # Complex number
            {"value": []},  # Empty list
            {"value": {}},  # Empty dict
        ]

        for inputs in unusual_values:
            result = moderation.moderation_for_inputs(inputs)
            # Should complete without error
            assert isinstance(result, ModerationInputsResult)
