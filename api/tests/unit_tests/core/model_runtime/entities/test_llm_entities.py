"""Tests for LLMUsage entity."""

from decimal import Decimal

from core.model_runtime.entities.llm_entities import LLMUsage, LLMUsageMetadata


class TestLLMUsage:
    """Test cases for LLMUsage class."""

    def test_from_metadata_with_all_tokens(self):
        """Test from_metadata when all token types are provided."""
        metadata: LLMUsageMetadata = {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
            "prompt_unit_price": 0.001,
            "completion_unit_price": 0.002,
            "total_price": 0.2,
            "currency": "USD",
            "latency": 1.5,
        }

        usage = LLMUsage.from_metadata(metadata)

        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50
        assert usage.total_tokens == 150
        assert usage.prompt_unit_price == Decimal("0.001")
        assert usage.completion_unit_price == Decimal("0.002")
        assert usage.total_price == Decimal("0.2")
        assert usage.currency == "USD"
        assert usage.latency == 1.5

    def test_from_metadata_with_prompt_tokens_only(self):
        """Test from_metadata when only prompt_tokens is provided."""
        metadata: LLMUsageMetadata = {
            "prompt_tokens": 100,
            "total_tokens": 100,
        }

        usage = LLMUsage.from_metadata(metadata)

        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 0
        assert usage.total_tokens == 100

    def test_from_metadata_with_completion_tokens_only(self):
        """Test from_metadata when only completion_tokens is provided."""
        metadata: LLMUsageMetadata = {
            "completion_tokens": 50,
            "total_tokens": 50,
        }

        usage = LLMUsage.from_metadata(metadata)

        assert usage.prompt_tokens == 0
        assert usage.completion_tokens == 50
        assert usage.total_tokens == 50

    def test_from_metadata_calculates_total_when_missing(self):
        """Test from_metadata calculates total_tokens when not provided."""
        metadata: LLMUsageMetadata = {
            "prompt_tokens": 100,
            "completion_tokens": 50,
        }

        usage = LLMUsage.from_metadata(metadata)

        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50
        assert usage.total_tokens == 150  # Should be calculated

    def test_from_metadata_with_total_but_no_completion(self):
        """
        Test from_metadata when total_tokens is provided but completion_tokens is 0.
        This tests the fix for issue #24360 - prompt tokens should NOT be assigned to completion_tokens.
        """
        metadata: LLMUsageMetadata = {
            "prompt_tokens": 479,
            "completion_tokens": 0,
            "total_tokens": 521,
        }

        usage = LLMUsage.from_metadata(metadata)

        # This is the key fix - prompt tokens should remain as prompt tokens
        assert usage.prompt_tokens == 479
        assert usage.completion_tokens == 0
        assert usage.total_tokens == 521

    def test_from_metadata_with_empty_metadata(self):
        """Test from_metadata with empty metadata."""
        metadata: LLMUsageMetadata = {}

        usage = LLMUsage.from_metadata(metadata)

        assert usage.prompt_tokens == 0
        assert usage.completion_tokens == 0
        assert usage.total_tokens == 0
        assert usage.currency == "USD"
        assert usage.latency == 0.0

    def test_from_metadata_preserves_zero_completion_tokens(self):
        """
        Test that zero completion_tokens are preserved when explicitly set.
        This is important for agent nodes that only use prompt tokens.
        """
        metadata: LLMUsageMetadata = {
            "prompt_tokens": 1000,
            "completion_tokens": 0,
            "total_tokens": 1000,
            "prompt_unit_price": 0.15,
            "completion_unit_price": 0.60,
            "prompt_price": 0.00015,
            "completion_price": 0,
            "total_price": 0.00015,
        }

        usage = LLMUsage.from_metadata(metadata)

        assert usage.prompt_tokens == 1000
        assert usage.completion_tokens == 0
        assert usage.total_tokens == 1000
        assert usage.prompt_price == Decimal("0.00015")
        assert usage.completion_price == Decimal(0)
        assert usage.total_price == Decimal("0.00015")

    def test_from_metadata_with_decimal_values(self):
        """Test from_metadata handles decimal values correctly."""
        metadata: LLMUsageMetadata = {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
            "prompt_unit_price": "0.001",
            "completion_unit_price": "0.002",
            "prompt_price": "0.1",
            "completion_price": "0.1",
            "total_price": "0.2",
        }

        usage = LLMUsage.from_metadata(metadata)

        assert usage.prompt_unit_price == Decimal("0.001")
        assert usage.completion_unit_price == Decimal("0.002")
        assert usage.prompt_price == Decimal("0.1")
        assert usage.completion_price == Decimal("0.1")
        assert usage.total_price == Decimal("0.2")
