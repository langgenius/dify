"""Test cases for streaming provider response ID functionality."""

from unittest.mock import MagicMock

import pytest

from core.model_runtime.entities.llm_entities import (
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultChunkWithStructuredOutput,
)
from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.workflow.node_events.node import ModelInvokeCompletedEvent
from core.workflow.nodes.llm.node import LLMNode


class TestStreamingProviderResponseId:
    """Test cases for streaming provider response ID functionality."""

    def test_streaming_chunk_captures_provider_response_id(self):
        """Test that LLMResultChunk captures provider response ID."""
        test_provider_response_id = "chatcmpl-stream-test-123"

        # Create streaming chunk with provider response ID
        chunk = LLMResultChunk(
            id=test_provider_response_id,
            model="gpt-4",
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="test response")),
        )

        assert chunk.id == test_provider_response_id

    def test_streaming_chunk_with_structured_output_captures_provider_response_id(self):
        """Test that LLMResultChunkWithStructuredOutput captures provider response ID."""
        test_provider_response_id = "chatcmpl-structured-stream-456"

        # Create streaming chunk with provider response ID
        chunk = LLMResultChunkWithStructuredOutput(
            id=test_provider_response_id,
            model="gpt-4",
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="test response")),
            structured_output={"test": "data"},
        )

        assert chunk.id == test_provider_response_id

    def test_llm_node_preserves_provider_response_id_in_streaming(self):
        """Test that LLMNode preserves provider response ID from streaming chunks."""
        test_provider_response_id = "chatcmpl-llm-node-test-789"

        # Create mock streaming result generator with provider response ID
        mock_chunks = [
            LLMResultChunk(
                id=test_provider_response_id,
                model="gpt-4",
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="test response")),
            ),
            LLMResultChunk(
                id=test_provider_response_id,  # Same ID in subsequent chunks
                model="gpt-4",
                delta=LLMResultChunkDelta(index=1, message=AssistantPromptMessage(content="test response")),
            ),
        ]

        # Create a generator that yields the chunks
        def mock_generator():
            yield from mock_chunks

        # Test that the LLMNode handle_invoke_result extracts the provider response ID
        file_saver = MagicMock()
        file_outputs = []
        node_id = "test-node"
        node_type = "llm"

        # Collect the events from the generator
        events = []
        for event in LLMNode.handle_invoke_result(
            invoke_result=mock_generator(),
            file_saver=file_saver,
            file_outputs=file_outputs,
            node_id=node_id,
            node_type=node_type,
            request_start_time=None,
        ):
            events.append(event)
            if isinstance(event, ModelInvokeCompletedEvent):
                # Check that the ModelInvokeCompletedEvent has the provider response ID
                assert event.provider_response_id == test_provider_response_id
                break
        else:
            pytest.fail("ModelInvokeCompletedEvent not found in streaming events")

    def test_llm_node_handles_missing_provider_response_id_in_streaming(self):
        """Test that LLMNode handles missing provider response ID in streaming gracefully."""
        # Create mock streaming result generator without provider response ID
        mock_chunks = [
            LLMResultChunk(
                id=None,  # No provider response ID
                model="gpt-4",
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="test response")),
            ),
            LLMResultChunk(
                id=None,  # Still no provider response ID
                model="gpt-4",
                delta=LLMResultChunkDelta(index=1, message=AssistantPromptMessage(content="test response")),
            ),
        ]

        # Create a generator that yields the chunks
        def mock_generator():
            yield from mock_chunks

        # Test that the LLMNode handle_invoke_result handles missing provider response ID
        file_saver = MagicMock()
        file_outputs = []
        node_id = "test-node"
        node_type = "llm"

        # Collect the events from the generator
        events = []
        for event in LLMNode.handle_invoke_result(
            invoke_result=mock_generator(),
            file_saver=file_saver,
            file_outputs=file_outputs,
            node_id=node_id,
            node_type=node_type,
            request_start_time=None,
        ):
            events.append(event)
            if isinstance(event, ModelInvokeCompletedEvent):
                # Check that the ModelInvokeCompletedEvent has None for provider response ID
                assert event.provider_response_id is None
                break
        else:
            pytest.fail("ModelInvokeCompletedEvent not found in streaming events")
