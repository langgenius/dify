from types import SimpleNamespace
from unittest.mock import ANY, Mock, patch

import pytest

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueAgentMessageEvent,
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueMessageFileEvent,
    QueuePingEvent,
)
from core.app.entities.task_entities import (
    EasyUITaskState,
    ErrorStreamResponse,
    MessageEndStreamResponse,
    MessageFileStreamResponse,
    MessageReplaceStreamResponse,
    MessageStreamResponse,
    PingStreamResponse,
    StreamEvent,
)
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.base.tts import AppGeneratorTTSPublisher
from core.model_runtime.entities.llm_entities import LLMResult as RuntimeLLMResult
from core.model_runtime.entities.message_entities import TextPromptMessageContent
from core.ops.ops_trace_manager import TraceQueueManager
from models.model import AppMode


class TestEasyUIBasedGenerateTaskPipelineProcessStreamResponse:
    """Test cases for EasyUIBasedGenerateTaskPipeline._process_stream_response method."""

    @pytest.fixture
    def mock_application_generate_entity(self):
        """Create a mock application generate entity."""
        entity = Mock(spec=ChatAppGenerateEntity)
        entity.task_id = "test-task-id"
        entity.app_id = "test-app-id"
        # minimal app_config used by pipeline internals
        entity.app_config = SimpleNamespace(
            tenant_id="test-tenant-id",
            app_id="test-app-id",
            app_mode=AppMode.CHAT,
            app_model_config_dict={},
            additional_features=None,
            sensitive_word_avoidance=None,
        )
        # minimal model_conf for LLMResult init
        entity.model_conf = SimpleNamespace(
            model="test-model",
            provider_model_bundle=SimpleNamespace(model_type_instance=Mock()),
            credentials={},
        )
        return entity

    @pytest.fixture
    def mock_queue_manager(self):
        """Create a mock queue manager."""
        manager = Mock(spec=AppQueueManager)
        return manager

    @pytest.fixture
    def mock_message_cycle_manager(self):
        """Create a mock message cycle manager."""
        manager = Mock()
        manager.get_message_event_type.return_value = StreamEvent.MESSAGE
        manager.message_to_stream_response.return_value = Mock(spec=MessageStreamResponse)
        manager.message_file_to_stream_response.return_value = Mock(spec=MessageFileStreamResponse)
        manager.message_replace_to_stream_response.return_value = Mock(spec=MessageReplaceStreamResponse)
        manager.handle_retriever_resources = Mock()
        manager.handle_annotation_reply.return_value = None
        return manager

    @pytest.fixture
    def mock_conversation(self):
        """Create a mock conversation."""
        conversation = Mock()
        conversation.id = "test-conversation-id"
        conversation.mode = "chat"
        return conversation

    @pytest.fixture
    def mock_message(self):
        """Create a mock message."""
        message = Mock()
        message.id = "test-message-id"
        message.created_at = Mock()
        message.created_at.timestamp.return_value = 1234567890
        return message

    @pytest.fixture
    def mock_task_state(self):
        """Create a mock task state."""
        task_state = Mock(spec=EasyUITaskState)

        # Create LLM result mock
        llm_result = Mock(spec=RuntimeLLMResult)
        llm_result.prompt_messages = []
        llm_result.message = Mock()
        llm_result.message.content = ""

        task_state.llm_result = llm_result
        task_state.answer = ""

        return task_state

    @pytest.fixture
    def pipeline(
        self,
        mock_application_generate_entity,
        mock_queue_manager,
        mock_conversation,
        mock_message,
        mock_message_cycle_manager,
        mock_task_state,
    ):
        """Create an EasyUIBasedGenerateTaskPipeline instance with mocked dependencies."""
        with patch(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.EasyUITaskState", return_value=mock_task_state
        ):
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=mock_application_generate_entity,
                queue_manager=mock_queue_manager,
                conversation=mock_conversation,
                message=mock_message,
                stream=True,
            )
            pipeline._message_cycle_manager = mock_message_cycle_manager
            pipeline._task_state = mock_task_state
            return pipeline

    def test_get_message_event_type_called_once_when_first_llm_chunk_arrives(
        self, pipeline, mock_message_cycle_manager
    ):
        """Expect get_message_event_type to be called when processing the first LLM chunk event."""
        # Setup a minimal LLM chunk event
        chunk = Mock()
        chunk.delta.message.content = "hi"
        chunk.prompt_messages = []
        llm_chunk_event = Mock(spec=QueueLLMChunkEvent)
        llm_chunk_event.chunk = chunk
        mock_queue_message = Mock()
        mock_queue_message.event = llm_chunk_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        # Execute
        list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        mock_message_cycle_manager.get_message_event_type.assert_called_once_with(message_id="test-message-id")

    def test_llm_chunk_event_with_text_content(self, pipeline, mock_message_cycle_manager, mock_task_state):
        """Test handling of LLM chunk events with text content."""
        # Setup
        chunk = Mock()
        chunk.delta.message.content = "Hello, world!"
        chunk.prompt_messages = []

        llm_chunk_event = Mock(spec=QueueLLMChunkEvent)
        llm_chunk_event.chunk = chunk

        mock_queue_message = Mock()
        mock_queue_message.event = llm_chunk_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        mock_message_cycle_manager.get_message_event_type.return_value = StreamEvent.MESSAGE

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        mock_message_cycle_manager.message_to_stream_response.assert_called_once_with(
            answer="Hello, world!", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
        assert mock_task_state.llm_result.message.content == "Hello, world!"

    def test_llm_chunk_event_with_list_content(self, pipeline, mock_message_cycle_manager, mock_task_state):
        """Test handling of LLM chunk events with list content."""
        # Setup
        text_content = Mock(spec=TextPromptMessageContent)
        text_content.data = "Hello"

        chunk = Mock()
        chunk.delta.message.content = [text_content, " world!"]
        chunk.prompt_messages = []

        llm_chunk_event = Mock(spec=QueueLLMChunkEvent)
        llm_chunk_event.chunk = chunk

        mock_queue_message = Mock()
        mock_queue_message.event = llm_chunk_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        mock_message_cycle_manager.get_message_event_type.return_value = StreamEvent.MESSAGE

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        mock_message_cycle_manager.message_to_stream_response.assert_called_once_with(
            answer="Hello world!", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
        assert mock_task_state.llm_result.message.content == "Hello world!"

    def test_agent_message_event(self, pipeline, mock_message_cycle_manager, mock_task_state):
        """Test handling of agent message events."""
        # Setup
        chunk = Mock()
        chunk.delta.message.content = "Agent response"

        agent_message_event = Mock(spec=QueueAgentMessageEvent)
        agent_message_event.chunk = chunk

        mock_queue_message = Mock()
        mock_queue_message.event = agent_message_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        # Ensure method under assertion is a mock to track calls
        pipeline._agent_message_to_stream_response = Mock(return_value=Mock())

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        # Agent messages should use _agent_message_to_stream_response
        pipeline._agent_message_to_stream_response.assert_called_once_with(
            answer="Agent response", message_id="test-message-id"
        )

    def test_message_end_event(self, pipeline, mock_message_cycle_manager, mock_task_state):
        """Test handling of message end events."""
        # Setup
        llm_result = Mock(spec=RuntimeLLMResult)
        llm_result.message = Mock()
        llm_result.message.content = "Final response"

        message_end_event = Mock(spec=QueueMessageEndEvent)
        message_end_event.llm_result = llm_result

        mock_queue_message = Mock()
        mock_queue_message.event = message_end_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        pipeline._save_message = Mock()
        pipeline._message_end_to_stream_response = Mock(return_value=Mock(spec=MessageEndStreamResponse))

        # Patch db.engine used inside pipeline for session creation
        with patch(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db", new=SimpleNamespace(engine=Mock())
        ):
            # Execute
            responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        assert mock_task_state.llm_result == llm_result
        pipeline._save_message.assert_called_once()
        pipeline._message_end_to_stream_response.assert_called_once()

    def test_error_event(self, pipeline):
        """Test handling of error events."""
        # Setup
        error_event = Mock(spec=QueueErrorEvent)
        error_event.error = Exception("Test error")

        mock_queue_message = Mock()
        mock_queue_message.event = error_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        pipeline.handle_error = Mock(return_value=Exception("Test error"))
        pipeline.error_to_stream_response = Mock(return_value=Mock(spec=ErrorStreamResponse))

        # Patch db.engine used inside pipeline for session creation
        with patch(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db", new=SimpleNamespace(engine=Mock())
        ):
            # Execute
            responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        pipeline.handle_error.assert_called_once()
        pipeline.error_to_stream_response.assert_called_once()

    def test_ping_event(self, pipeline):
        """Test handling of ping events."""
        # Setup
        ping_event = Mock(spec=QueuePingEvent)

        mock_queue_message = Mock()
        mock_queue_message.event = ping_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        pipeline.ping_stream_response = Mock(return_value=Mock(spec=PingStreamResponse))

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        pipeline.ping_stream_response.assert_called_once()

    def test_file_event(self, pipeline, mock_message_cycle_manager):
        """Test handling of file events."""
        # Setup
        file_event = Mock(spec=QueueMessageFileEvent)
        file_event.message_file_id = "file-id"

        mock_queue_message = Mock()
        mock_queue_message.event = file_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        file_response = Mock(spec=MessageFileStreamResponse)
        mock_message_cycle_manager.message_file_to_stream_response.return_value = file_response

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        assert responses[0] == file_response
        mock_message_cycle_manager.message_file_to_stream_response.assert_called_once_with(file_event)

    def test_publisher_is_called_with_messages(self, pipeline):
        """Test that publisher publishes messages when provided."""
        # Setup
        publisher = Mock(spec=AppGeneratorTTSPublisher)

        ping_event = Mock(spec=QueuePingEvent)
        mock_queue_message = Mock()
        mock_queue_message.event = ping_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        pipeline.ping_stream_response = Mock(return_value=Mock(spec=PingStreamResponse))

        # Execute
        list(pipeline._process_stream_response(publisher=publisher, trace_manager=None))

        # Assert
        # Called once with message and once with None at the end
        assert publisher.publish.call_count == 2
        publisher.publish.assert_any_call(mock_queue_message)
        publisher.publish.assert_any_call(None)

    def test_trace_manager_passed_to_save_message(self, pipeline):
        """Test that trace manager is passed to _save_message."""
        # Setup
        trace_manager = Mock(spec=TraceQueueManager)

        message_end_event = Mock(spec=QueueMessageEndEvent)
        message_end_event.llm_result = None

        mock_queue_message = Mock()
        mock_queue_message.event = message_end_event
        pipeline.queue_manager.listen.return_value = [mock_queue_message]

        pipeline._save_message = Mock()
        pipeline._message_end_to_stream_response = Mock(return_value=Mock(spec=MessageEndStreamResponse))

        # Patch db.engine used inside pipeline for session creation
        with patch(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db", new=SimpleNamespace(engine=Mock())
        ):
            # Execute
            list(pipeline._process_stream_response(publisher=None, trace_manager=trace_manager))

        # Assert
        pipeline._save_message.assert_called_once_with(session=ANY, trace_manager=trace_manager)

    def test_multiple_events_sequence(self, pipeline, mock_message_cycle_manager, mock_task_state):
        """Test handling multiple events in sequence."""
        # Setup
        chunk1 = Mock()
        chunk1.delta.message.content = "Hello"
        chunk1.prompt_messages = []

        chunk2 = Mock()
        chunk2.delta.message.content = " world!"
        chunk2.prompt_messages = []

        llm_chunk_event1 = Mock(spec=QueueLLMChunkEvent)
        llm_chunk_event1.chunk = chunk1

        ping_event = Mock(spec=QueuePingEvent)

        llm_chunk_event2 = Mock(spec=QueueLLMChunkEvent)
        llm_chunk_event2.chunk = chunk2

        mock_queue_messages = [
            Mock(event=llm_chunk_event1),
            Mock(event=ping_event),
            Mock(event=llm_chunk_event2),
        ]
        pipeline.queue_manager.listen.return_value = mock_queue_messages

        mock_message_cycle_manager.get_message_event_type.return_value = StreamEvent.MESSAGE
        pipeline.ping_stream_response = Mock(return_value=Mock(spec=PingStreamResponse))

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 3
        assert mock_task_state.llm_result.message.content == "Hello world!"

        # Verify calls to message_to_stream_response
        assert mock_message_cycle_manager.message_to_stream_response.call_count == 2
        mock_message_cycle_manager.message_to_stream_response.assert_any_call(
            answer="Hello", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
        mock_message_cycle_manager.message_to_stream_response.assert_any_call(
            answer=" world!", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
