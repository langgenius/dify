"""Tests for LLM Node first token timeout retry functionality."""

import time
from collections.abc import Generator
from unittest import mock

import pytest

from core.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.workflow.nodes.base.entities import RetryConfig
from core.workflow.utils.generator_timeout import FirstTokenTimeoutError, with_first_token_timeout


class TestRetryConfigFirstTokenTimeout:
    """Test cases for RetryConfig first token timeout fields."""

    def test_default_values(self):
        """Test that first token timeout fields have correct default values."""
        config = RetryConfig()

        assert config.first_token_timeout == 0
        assert config.has_first_token_timeout is False

    def test_has_first_token_timeout_when_retry_enabled_and_positive(self):
        """Test has_first_token_timeout returns True when retry enabled with positive timeout."""
        config = RetryConfig(
            retry_enabled=True,
            first_token_timeout=3000,  # 3000ms = 3s
        )

        assert config.has_first_token_timeout is True
        assert config.first_token_timeout_seconds == 3.0

    def test_has_first_token_timeout_when_retry_disabled(self):
        """Test has_first_token_timeout returns False when retry is disabled."""
        config = RetryConfig(
            retry_enabled=False,
            first_token_timeout=60,
        )

        assert config.has_first_token_timeout is False

    def test_has_first_token_timeout_when_zero_timeout(self):
        """Test has_first_token_timeout returns False when timeout is 0."""
        config = RetryConfig(
            retry_enabled=True,
            first_token_timeout=0,
        )

        assert config.has_first_token_timeout is False

    def test_backward_compatibility(self):
        """Test that existing workflows without first_token_timeout work correctly."""
        old_config_data = {
            "max_retries": 3,
            "retry_interval": 1000,
            "retry_enabled": True,
        }

        config = RetryConfig.model_validate(old_config_data)

        assert config.max_retries == 3
        assert config.retry_interval == 1000
        assert config.retry_enabled is True
        assert config.first_token_timeout == 0
        # has_first_token_timeout is False because timeout is 0
        assert config.has_first_token_timeout is False

    def test_full_config_serialization(self):
        """Test that full config can be serialized and deserialized."""
        config = RetryConfig(
            max_retries=5,
            retry_interval=2000,
            retry_enabled=True,
            first_token_timeout=120,
        )

        config_dict = config.model_dump()
        restored_config = RetryConfig.model_validate(config_dict)

        assert restored_config.max_retries == 5
        assert restored_config.retry_interval == 2000
        assert restored_config.retry_enabled is True
        assert restored_config.first_token_timeout == 120
        assert restored_config.has_first_token_timeout is True


class TestWithFirstTokenTimeout:
    """Test cases for with_first_token_timeout function."""

    @staticmethod
    def _create_mock_chunk(text: str = "test") -> LLMResultChunk:
        """Helper to create a mock LLMResultChunk."""
        return LLMResultChunk(
            model="test-model",
            prompt_messages=[],
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=text),
            ),
        )

    def test_first_token_arrives_within_timeout(self):
        """Test that chunks are yielded normally when first token arrives in time."""

        def mock_generator() -> Generator[LLMResultChunk, None, None]:
            yield self._create_mock_chunk("Hello")
            yield self._create_mock_chunk(" world")

        wrapped = with_first_token_timeout(mock_generator(), timeout_seconds=10)
        chunks = list(wrapped)

        assert len(chunks) == 2

    def test_first_token_timeout_raises_error(self, monkeypatch):
        """Test that timeout error is raised when first token doesn't arrive in time."""
        call_count = 0

        def mock_monotonic():
            nonlocal call_count
            call_count += 1
            # First call: start_time = 0
            # Second call (when checking): current_time = 11 (exceeds 10 second timeout)
            if call_count == 1:
                return 0.0
            return 11.0

        monkeypatch.setattr(time, "monotonic", mock_monotonic)

        def slow_generator() -> Generator[LLMResultChunk, None, None]:
            # This chunk arrives "after timeout"
            yield self._create_mock_chunk("Late token")

        wrapped = with_first_token_timeout(slow_generator(), timeout_seconds=10)

        with pytest.raises(FirstTokenTimeoutError) as exc_info:
            list(wrapped)

        # Error message shows milliseconds (10 seconds = 10000ms)
        assert "10000ms" in str(exc_info.value)

    def test_no_timeout_check_after_first_token(self, monkeypatch):
        """Test that subsequent chunks are not subject to timeout after first token received."""
        call_count = 0

        def mock_monotonic():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return 0.0  # start_time
            elif call_count == 2:
                return 5.0  # first token arrives at 5s (within 10s timeout)
            else:
                # Subsequent calls simulate long delays for remaining chunks
                # These should NOT trigger timeout because first token already received
                return 100.0 + call_count

        monkeypatch.setattr(time, "monotonic", mock_monotonic)

        def generator_with_slow_subsequent_chunks() -> Generator[LLMResultChunk, None, None]:
            yield self._create_mock_chunk("First")
            yield self._create_mock_chunk("Second")
            yield self._create_mock_chunk("Third")

        wrapped = with_first_token_timeout(
            generator_with_slow_subsequent_chunks(),
            timeout_seconds=10,
        )

        # Should not raise, even though "time" passes beyond timeout after first token
        chunks = list(wrapped)
        assert len(chunks) == 3

    def test_empty_generator_no_error(self):
        """Test that empty generator doesn't raise timeout error (no chunks to check)."""

        def empty_generator() -> Generator[LLMResultChunk, None, None]:
            return
            yield  # unreachable, but makes this a generator

        wrapped = with_first_token_timeout(empty_generator(), timeout_seconds=10)
        chunks = list(wrapped)

        assert chunks == []

    def test_exact_timeout_boundary(self, monkeypatch):
        """Test behavior at exact timeout boundary (should not raise when equal)."""
        call_count = 0

        def mock_monotonic():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return 0.0
            # Exactly at boundary: current_time - start_time = 10, timeout_seconds = 10
            # Since we check > not >=, this should NOT raise
            return 10.0

        monkeypatch.setattr(time, "monotonic", mock_monotonic)

        def generator() -> Generator[LLMResultChunk, None, None]:
            yield self._create_mock_chunk("Token at boundary")

        wrapped = with_first_token_timeout(generator(), timeout_seconds=10)

        # Should not raise because 10 is not > 10
        chunks = list(wrapped)
        assert len(chunks) == 1

    def test_just_over_timeout_boundary(self, monkeypatch):
        """Test behavior just over timeout boundary (should raise)."""
        call_count = 0

        def mock_monotonic():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return 0.0
            # Just over boundary
            return 10.001

        monkeypatch.setattr(time, "monotonic", mock_monotonic)

        def generator() -> Generator[LLMResultChunk, None, None]:
            yield self._create_mock_chunk("Late token")

        wrapped = with_first_token_timeout(generator(), timeout_seconds=10)

        with pytest.raises(FirstTokenTimeoutError):
            list(wrapped)


class TestLLMNodeInvokeLLMWithTimeout:
    """Test cases for LLMNode.invoke_llm with first_token_timeout parameter."""

    def test_invoke_llm_without_timeout(self):
        """Test invoke_llm works normally when first_token_timeout is None."""
        from core.workflow.nodes.llm.node import LLMNode

        with mock.patch.object(LLMNode, "handle_invoke_result") as mock_handle:
            mock_handle.return_value = iter([])

            # Mock model_instance.invoke_llm to return empty generator
            mock_model_instance = mock.MagicMock()
            mock_model_instance.invoke_llm.return_value = iter([])
            mock_model_instance.model_type_instance.get_model_schema.return_value = mock.MagicMock()

            mock_node_data_model = mock.MagicMock()
            mock_node_data_model.completion_params = {}

            result = LLMNode.invoke_llm(
                node_data_model=mock_node_data_model,
                model_instance=mock_model_instance,
                prompt_messages=[],
                user_id="test-user",
                structured_output_enabled=False,
                structured_output=None,
                file_saver=mock.MagicMock(),
                file_outputs=[],
                node_id="test-node",
                node_type=mock.MagicMock(),
                first_token_timeout=None,  # No timeout
            )

            list(result)  # Consume generator
            mock_handle.assert_called_once()

    def test_invoke_llm_with_timeout_passes_to_model_instance(self):
        """Test invoke_llm passes first_token_timeout to model_instance.invoke_llm."""
        from core.workflow.nodes.llm.node import LLMNode

        with mock.patch.object(LLMNode, "handle_invoke_result") as mock_handle:
            mock_handle.return_value = iter([])

            mock_model_instance = mock.MagicMock()
            mock_model_instance.invoke_llm.return_value = iter([])
            mock_model_instance.model_type_instance.get_model_schema.return_value = mock.MagicMock()

            mock_node_data_model = mock.MagicMock()
            mock_node_data_model.completion_params = {}

            result = LLMNode.invoke_llm(
                node_data_model=mock_node_data_model,
                model_instance=mock_model_instance,
                prompt_messages=[],
                user_id="test-user",
                structured_output_enabled=False,
                structured_output=None,
                file_saver=mock.MagicMock(),
                file_outputs=[],
                node_id="test-node",
                node_type=mock.MagicMock(),
                first_token_timeout=60,  # With timeout
            )

            list(result)  # Consume generator

            # Verify model_instance.invoke_llm was called with first_token_timeout
            mock_model_instance.invoke_llm.assert_called_once()
            call_kwargs = mock_model_instance.invoke_llm.call_args.kwargs
            assert call_kwargs.get("first_token_timeout") == 60

    def test_invoke_llm_with_zero_timeout_passes_zero(self):
        """Test invoke_llm passes zero timeout to model_instance."""
        from core.workflow.nodes.llm.node import LLMNode

        with mock.patch.object(LLMNode, "handle_invoke_result") as mock_handle:
            mock_handle.return_value = iter([])

            mock_model_instance = mock.MagicMock()
            mock_model_instance.invoke_llm.return_value = iter([])
            mock_model_instance.model_type_instance.get_model_schema.return_value = mock.MagicMock()

            mock_node_data_model = mock.MagicMock()
            mock_node_data_model.completion_params = {}

            result = LLMNode.invoke_llm(
                node_data_model=mock_node_data_model,
                model_instance=mock_model_instance,
                prompt_messages=[],
                user_id="test-user",
                structured_output_enabled=False,
                structured_output=None,
                file_saver=mock.MagicMock(),
                file_outputs=[],
                node_id="test-node",
                node_type=mock.MagicMock(),
                first_token_timeout=0,  # Zero timeout
            )

            list(result)  # Consume generator

            # Verify model_instance.invoke_llm was called with zero timeout
            mock_model_instance.invoke_llm.assert_called_once()
            call_kwargs = mock_model_instance.invoke_llm.call_args.kwargs
            assert call_kwargs.get("first_token_timeout") == 0


class TestRetryConfigIntegration:
    """Integration tests for RetryConfig with LLM node data."""

    def test_retry_config_in_node_data(self):
        """Test RetryConfig can be properly configured in LLMNodeData."""
        from core.model_runtime.entities.llm_entities import LLMMode
        from core.workflow.nodes.llm.entities import ContextConfig, LLMNodeData, ModelConfig

        node_data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(
                provider="openai",
                name="gpt-4",
                mode=LLMMode.CHAT,
                completion_params={},
            ),
            prompt_template=[],
            context=ContextConfig(enabled=False),
            structured_output_enabled=False,
            retry_config=RetryConfig(
                max_retries=3,
                retry_interval=1000,
                retry_enabled=True,
                first_token_timeout=3000,  # 3000ms = 3s
            ),
        )

        assert node_data.retry_config.max_retries == 3
        assert node_data.retry_config.retry_enabled is True
        assert node_data.retry_config.first_token_timeout == 3000
        assert node_data.retry_config.first_token_timeout_seconds == 3.0
        assert node_data.retry_config.has_first_token_timeout is True

    def test_default_retry_config_in_node_data(self):
        """Test default RetryConfig in LLMNodeData."""
        from core.model_runtime.entities.llm_entities import LLMMode
        from core.workflow.nodes.llm.entities import ContextConfig, LLMNodeData, ModelConfig

        node_data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(
                provider="openai",
                name="gpt-4",
                mode=LLMMode.CHAT,
                completion_params={},
            ),
            prompt_template=[],
            context=ContextConfig(enabled=False),
            structured_output_enabled=False,
        )

        # Should have default RetryConfig
        assert node_data.retry_config.max_retries == 0
        assert node_data.retry_config.retry_enabled is False
        assert node_data.retry_config.first_token_timeout == 0
        assert node_data.retry_config.has_first_token_timeout is False
