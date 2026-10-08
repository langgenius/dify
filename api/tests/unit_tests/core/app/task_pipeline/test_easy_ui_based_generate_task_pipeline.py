from collections.abc import Generator, Iterator
from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    MessageQueueMessage,
    QueueAgentMessageEvent,
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueMessageFileEvent,
    QueuePingEvent,
    WorkflowQueueMessage,
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
from core.base.tts import AppGeneratorTTSPublisher
from core.ops.ops_trace_manager import TraceQueueManager
from graphon.model_runtime.entities.llm_entities import LLMResult as RuntimeLLMResult
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, TextPromptMessageContent
from models.enums import ConversationFromSource
from models.model import AppMode, Conversation, Message
from services.app.generation.adapters.message_pipeline import EasyUIBasedGenerateTaskPipeline
from tests.unit_tests.core.model_fixtures import make_model_config


class _QueueManager(AppQueueManager):
    """Finite in-memory event source for stream dispatch tests."""

    def __init__(self) -> None:
        self.messages: list[MessageQueueMessage] = []

    def listen(self) -> Generator[MessageQueueMessage]:
        yield from self.messages

    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        raise AssertionError("Stream dispatch must not publish queue events")


class _Publisher(AppGeneratorTTSPublisher):
    """Record speech input without starting synthesis or a worker thread."""

    def __init__(self) -> None:
        self.messages: list[WorkflowQueueMessage | MessageQueueMessage | None] = []

    def publish(self, message: WorkflowQueueMessage | MessageQueueMessage | None, /) -> None:
        self.messages.append(message)


def queue_message(event: AppQueueEvent) -> MessageQueueMessage:
    return MessageQueueMessage(
        task_id="test-task-id",
        app_mode=AppMode.CHAT,
        message_id="test-message-id",
        conversation_id="test-conversation-id",
        event=event,
    )


def llm_chunk(content: str) -> LLMResultChunk:
    return LLMResultChunk(
        model="test-model",
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=content)),
    )


def llm_result(content: str) -> RuntimeLLMResult:
    return RuntimeLLMResult(
        model="test-model", message=AssistantPromptMessage(content=content), usage=LLMUsage.empty_usage()
    )


@pytest.fixture
def committed_sessions(sqlite_engine: Engine) -> Iterator[list[Session]]:
    sessions: list[Session] = []

    def record_commit(session: Session) -> None:
        if session.get_bind() is sqlite_engine:
            sessions.append(session)

    event.listen(Session, "after_commit", record_commit)
    yield sessions
    event.remove(Session, "after_commit", record_commit)


class TestEasyUIBasedGenerateTaskPipelineProcessStreamResponse:
    """Test cases for EasyUIBasedGenerateTaskPipeline._process_stream_response method."""

    @pytest.fixture
    def application_generate_entity(self):
        """Create a validated application request with real model configuration."""
        return ChatAppGenerateEntity(
            task_id="test-task-id",
            app_config=EasyUIBasedAppConfig(
                tenant_id="test-tenant-id",
                app_id="test-app-id",
                app_mode=AppMode.CHAT,
                app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
                app_model_config_dict={},
                model=ModelConfigEntity(provider="test-provider", model="test-model"),
                prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
            ),
            model_conf=make_model_config(provider="test-provider", model="test-model", mode="chat"),
            inputs={},
            files=[],
            user_id="test-user-id",
            stream=True,
            invoke_from=InvokeFrom.WEB_APP,
        )

    @pytest.fixture
    def queue_manager(self):
        return _QueueManager()

    @pytest.fixture
    def mock_message_cycle_manager(self):
        """Create a mock message cycle manager."""
        manager = Mock()
        manager.get_message_event_type.return_value = StreamEvent.MESSAGE
        manager.message_to_stream_response.return_value = MessageStreamResponse(
            task_id="test-task-id", id="test-message-id", answer="response"
        )
        manager.message_file_to_stream_response.return_value = MessageFileStreamResponse(
            task_id="test-task-id",
            id="file-id",
            type="image",
            belongs_to="assistant",
            url="https://example.com/file.png",
        )
        manager.message_replace_to_stream_response.return_value = MessageReplaceStreamResponse(
            task_id="test-task-id", answer="replacement", reason="moderation"
        )
        manager.handle_retriever_resources = Mock()
        manager.handle_annotation_reply.return_value = None
        return manager

    @pytest.fixture
    def conversation(self):
        """Create a transient mapped conversation."""
        return Conversation(
            id="test-conversation-id",
            app_id="test-app-id",
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source=ConversationFromSource.API,
            inputs={},
        )

    @pytest.fixture
    def message(self):
        """Create a transient mapped message."""
        return Message(
            id="test-message-id",
            created_at=datetime.fromtimestamp(1234567890, tz=UTC),
        )

    @pytest.fixture
    def task_state(self):
        """Create real mutable state for the stream response pipeline."""
        return EasyUITaskState(llm_result=llm_result(""))

    @pytest.fixture
    def pipeline(
        self,
        app_records,
        application_generate_entity,
        queue_manager,
        conversation,
        message,
        mock_message_cycle_manager,
        task_state,
    ):
        """Create an EasyUIBasedGenerateTaskPipeline instance with mocked dependencies."""
        pipeline = EasyUIBasedGenerateTaskPipeline(
            records=app_records,
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            stream=True,
        )
        pipeline._message_cycle_manager = mock_message_cycle_manager
        pipeline._task_state = task_state
        return pipeline

    def test_get_message_event_type_called_once_when_first_llm_chunk_arrives(
        self, pipeline, mock_message_cycle_manager
    ):
        """Expect get_message_event_type to be called when processing the first LLM chunk event."""
        # Setup a minimal LLM chunk event
        chunk = llm_chunk("hi")
        llm_chunk_event = QueueLLMChunkEvent(chunk=chunk)
        message = queue_message(llm_chunk_event)
        pipeline.queue_manager.messages = [message]

        # Execute
        list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        mock_message_cycle_manager.get_message_event_type.assert_called_once_with(message_id="test-message-id")

    def test_llm_chunk_event_with_text_content(self, pipeline, mock_message_cycle_manager, task_state):
        """Test handling of LLM chunk events with text content."""
        # Setup
        chunk = llm_chunk("Hello, world!")

        llm_chunk_event = QueueLLMChunkEvent(chunk=chunk)

        message = queue_message(llm_chunk_event)
        pipeline.queue_manager.messages = [message]

        mock_message_cycle_manager.get_message_event_type.return_value = StreamEvent.MESSAGE

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        mock_message_cycle_manager.message_to_stream_response.assert_called_once_with(
            answer="Hello, world!", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
        assert task_state.llm_result.message.content == "Hello, world!"

    def test_llm_chunk_event_with_list_content(self, pipeline, mock_message_cycle_manager, task_state):
        """Test handling of LLM chunk events with list content."""
        # Setup
        text_content = TextPromptMessageContent(data="Hello")
        chunk = llm_chunk("")
        # Preserve the legacy mixed-list payload handled by _chunk_delta_text.
        chunk.delta.message = AssistantPromptMessage.model_construct(content=[text_content, " world!"])

        llm_chunk_event = QueueLLMChunkEvent(chunk=chunk)

        message = queue_message(llm_chunk_event)
        pipeline.queue_manager.messages = [message]

        mock_message_cycle_manager.get_message_event_type.return_value = StreamEvent.MESSAGE

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        mock_message_cycle_manager.message_to_stream_response.assert_called_once_with(
            answer="Hello world!", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
        assert task_state.llm_result.message.content == "Hello world!"

    def test_agent_message_event(self, pipeline, mock_message_cycle_manager, task_state):
        """Test handling of agent message events."""
        # Setup
        chunk = llm_chunk("Agent response")

        agent_message_event = QueueAgentMessageEvent(chunk=chunk)

        message = queue_message(agent_message_event)
        pipeline.queue_manager.messages = [message]

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

    def test_message_end_event(self, pipeline, mock_message_cycle_manager, task_state, committed_sessions):
        """Test handling of message end events."""
        # Setup
        result = llm_result("Final response")
        message_end_event = QueueMessageEndEvent(llm_result=result)

        message = queue_message(message_end_event)
        pipeline.queue_manager.messages = [message]

        pipeline._save_message = Mock()
        pipeline._message_end_to_stream_response = Mock(
            return_value=MessageEndStreamResponse(task_id="test-task-id", id="test-message-id")
        )

        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        assert task_state.llm_result == result
        assert "session" not in pipeline._save_message.call_args.kwargs
        pipeline._message_end_to_stream_response.assert_called_once()

    def test_error_event(self, pipeline, committed_sessions):
        """Test handling of error events."""
        # Setup
        error_event = QueueErrorEvent(error=Exception("Test error"))

        message = queue_message(error_event)
        pipeline.queue_manager.messages = [message]

        pipeline.handle_error = Mock(return_value=Exception("Test error"))
        pipeline.error_to_stream_response = Mock(
            return_value=ErrorStreamResponse(task_id="test-task-id", err=Exception("Test error"))
        )

        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        assert len(committed_sessions) == 1
        pipeline.handle_error.assert_called_once_with(event=error_event)
        pipeline.error_to_stream_response.assert_called_once()

    def test_ping_event(self, pipeline):
        """Test handling of ping events."""
        # Setup
        ping_event = QueuePingEvent()

        message = queue_message(ping_event)
        pipeline.queue_manager.messages = [message]

        pipeline.ping_stream_response = Mock(return_value=PingStreamResponse(task_id="test-task-id"))

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 1
        pipeline.ping_stream_response.assert_called_once()

    def test_file_event(self, pipeline, mock_message_cycle_manager):
        """Test handling of file events."""
        # Setup
        file_event = QueueMessageFileEvent(message_file_id="file-id")

        message = queue_message(file_event)
        pipeline.queue_manager.messages = [message]

        file_response = MessageFileStreamResponse(
            task_id="test-task-id",
            id="file-id",
            type="image",
            belongs_to="assistant",
            url="https://example.com/file.png",
        )
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
        publisher = _Publisher()

        ping_event = QueuePingEvent()
        message = queue_message(ping_event)
        pipeline.queue_manager.messages = [message]

        pipeline.ping_stream_response = Mock(return_value=PingStreamResponse(task_id="test-task-id"))

        # Execute
        list(pipeline._process_stream_response(publisher=publisher, trace_manager=None))

        # Assert
        assert publisher.messages == [message]

    def test_trace_manager_passed_to_save_message(self, pipeline, committed_sessions):
        """Test that trace manager is passed to _save_message."""
        # Setup
        with (
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
            patch.object(TraceQueueManager, "start_timer"),
        ):
            trace_manager = TraceQueueManager(app_id="test-app-id")

        message_end_event = QueueMessageEndEvent(llm_result=None)

        message = queue_message(message_end_event)
        pipeline.queue_manager.messages = [message]

        pipeline._save_message = Mock()
        pipeline._message_end_to_stream_response = Mock(
            return_value=MessageEndStreamResponse(task_id="test-task-id", id="test-message-id")
        )

        list(pipeline._process_stream_response(publisher=None, trace_manager=trace_manager))

        # Assert
        assert "session" not in pipeline._save_message.call_args.kwargs
        pipeline._save_message.assert_called_once_with(trace_manager=trace_manager, preserve_existing_usage=False)

    def test_multiple_events_sequence(self, pipeline, mock_message_cycle_manager, task_state):
        """Test handling multiple events in sequence."""
        # Setup
        chunk1 = llm_chunk("Hello")

        chunk2 = llm_chunk(" world!")

        llm_chunk_event1 = QueueLLMChunkEvent(chunk=chunk1)

        ping_event = QueuePingEvent()

        llm_chunk_event2 = QueueLLMChunkEvent(chunk=chunk2)

        mock_queue_messages = [
            queue_message(llm_chunk_event1),
            queue_message(ping_event),
            queue_message(llm_chunk_event2),
        ]
        pipeline.queue_manager.messages = mock_queue_messages

        mock_message_cycle_manager.get_message_event_type.return_value = StreamEvent.MESSAGE
        pipeline.ping_stream_response = Mock(return_value=PingStreamResponse(task_id="test-task-id"))

        # Execute
        responses = list(pipeline._process_stream_response(publisher=None, trace_manager=None))

        # Assert
        assert len(responses) == 3
        assert task_state.llm_result.message.content == "Hello world!"

        # Verify calls to message_to_stream_response
        assert mock_message_cycle_manager.message_to_stream_response.call_count == 2
        mock_message_cycle_manager.message_to_stream_response.assert_any_call(
            answer="Hello", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
        mock_message_cycle_manager.message_to_stream_response.assert_any_call(
            answer=" world!", message_id="test-message-id", event_type=StreamEvent.MESSAGE
        )
