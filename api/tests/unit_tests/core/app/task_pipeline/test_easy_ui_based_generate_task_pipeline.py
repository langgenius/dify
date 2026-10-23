from __future__ import annotations

import json
import uuid
from collections.abc import Generator, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from threading import Thread
from typing import cast
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy import Engine as _easy_ui_based_generate_task_pipeline_Engine
from sqlalchemy import event
from sqlalchemy.engine import Engine as _easy_ui_message_end_files_Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, CompletionAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    MessageQueueMessage,
    QueueAgentMessageEvent,
    QueueAgentThoughtEvent,
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueMessageFileEvent,
    QueueMessageReplaceEvent,
    QueuePingEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    WorkflowQueueMessage,
)
from core.app.entities.task_entities import (
    AgentMessageStreamResponse,
    AgentThoughtStreamResponse,
    ChatbotAppStreamResponse,
    CompletionAppStreamResponse,
    EasyUITaskState,
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    MessageFileStreamResponse,
    MessageReplaceStreamResponse,
    MessageStreamResponse,
    PingStreamResponse,
    StreamEvent,
)
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.base.tts import AppGeneratorTTSPublisher, AudioTrunk
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager
from extensions.ext_redis import RedisClientWrapper
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.llm_entities import LLMResult as RuntimeLLMResult
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, TextPromptMessageContent
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import AppMode, Conversation, Message, MessageAgentThought, MessageFile, UploadFile
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.model_factories import make_upload_file


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


class TestEasyUiBasedGenerateTaskPipelineCases:
    @staticmethod
    @pytest.fixture
    def committed_sessions(sqlite_engine: _easy_ui_based_generate_task_pipeline_Engine) -> Iterator[list[Session]]:
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
            application_generate_entity,
            queue_manager,
            conversation,
            message,
            mock_message_cycle_manager,
            task_state,
        ):
            """Create an EasyUIBasedGenerateTaskPipeline instance with mocked dependencies."""
            pipeline = EasyUIBasedGenerateTaskPipeline(
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
            session = pipeline._save_message.call_args.kwargs["session"]
            assert isinstance(session, Session)
            assert committed_sessions == [session]
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
            session = pipeline.handle_error.call_args.kwargs["session"]
            assert isinstance(session, Session)
            assert committed_sessions == [session]
            pipeline.handle_error.assert_called_once_with(
                event=error_event, session=session, message_id="test-message-id"
            )
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
            session = pipeline._save_message.call_args.kwargs["session"]
            assert isinstance(session, Session)
            assert committed_sessions == [session]
            pipeline._save_message.assert_called_once_with(session=session, trace_manager=trace_manager)

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


class _DummyModelConf:
    def __init__(self) -> None:
        self.model = "mock"


class _UnknownQueueEvent:
    pass


@dataclass(eq=False, repr=False)
class _AnnotationReply:
    content: str


@dataclass(eq=False, repr=False)
class _ModelConfigMode:
    mode: str


@dataclass(eq=False, repr=False)
class _ProviderModelBundle:
    model_type_instance: object


class _AudioPublisher:
    def __init__(self, status: str, audio: str) -> None:
        self._audio = AudioTrunk(status, audio)

    def check_and_get_audio(self) -> AudioTrunk:
        return self._audio


class _TraceManagerDouble:
    def __init__(self) -> None:
        self.add_trace_task = Mock()


class _FakeQueueManager(AppQueueManager):
    def __init__(self) -> None:
        self._events: list[MessageQueueMessage | WorkflowQueueMessage] = []
        self.published_events: list[AppQueueEvent] = []

    def set_events(self, events: list[MessageQueueMessage | WorkflowQueueMessage]) -> None:
        self._events = events

    def listen(self) -> Generator[MessageQueueMessage | WorkflowQueueMessage]:
        yield from self._events

    def publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        self.published_events.append(event)

    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        self.published_events.append(event)


def _queue_message(event: AppQueueEvent) -> MessageQueueMessage:
    return MessageQueueMessage(
        task_id="task",
        app_mode=AppMode.CHAT.value,
        message_id="msg",
        conversation_id="conv",
        event=event,
    )


def _unknown_queue_message() -> MessageQueueMessage:
    return MessageQueueMessage.model_construct(
        task_id="task",
        app_mode=AppMode.CHAT.value,
        message_id="msg",
        conversation_id="conv",
        event=cast(AppQueueEvent, _UnknownQueueEvent()),
    )


def _make_conversation(app_mode: AppMode) -> Conversation:
    conversation = Conversation(
        app_id="app",
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=app_mode,
        name="conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.API,
        from_end_user_id="user",
        from_account_id=None,
    )
    conversation.id = "conv"
    conversation.mode = app_mode
    return conversation


def _make_message() -> Message:
    message = Message(
        app_id="app",
        conversation_id="conv",
        inputs={},
        query="query",
        message="",
        message_tokens=0,
        message_unit_price=0,
        message_price_unit=0,
        answer="",
        answer_tokens=0,
        answer_unit_price=0,
        answer_price_unit=0,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.API,
        from_end_user_id="user",
        from_account_id=None,
        app_mode=AppMode.CHAT,
    )
    message.id = "msg"
    message.created_at = datetime.now(UTC)
    return message


def _message_file(
    *,
    file_id: str,
    transfer_method: FileTransferMethod,
    url: str | None,
    upload_file_id: str | None,
    file_type: FileType = FileType.IMAGE,
) -> MessageFile:
    message_file = MessageFile(
        message_id="msg",
        type=file_type,
        transfer_method=transfer_method,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user",
        url=url,
        upload_file_id=upload_file_id,
    )
    message_file.id = file_id
    return message_file


def _upload_file(*, file_id: str, name: str, mime_type: str, size: int, extension: str) -> UploadFile:
    return make_upload_file(
        file_id=file_id,
        tenant_id="tenant",
        key=f"uploads/{file_id}",
        name=name,
        size=size,
        extension=extension,
        mime_type=mime_type,
        created_by="user",
        created_at=datetime.now(UTC),
    )


def _agent_thought() -> MessageAgentThought:
    thought = MessageAgentThought(
        message_id="msg",
        position=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user",
        thought="t",
        observation="o",
        tool="tool",
        tool_labels_str="{}",
        tool_input="input",
        answer="answer",
        message_files="[]",
    )
    thought.id = "thought"
    return thought


def _make_app_config(app_mode: AppMode) -> EasyUIBasedAppConfig:
    return EasyUIBasedAppConfig(
        tenant_id="tenant",
        app_id="app",
        app_mode=app_mode,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_id="model-config",
        app_model_config_dict={},
        model=ModelConfigEntity(provider="mock", model="mock"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="hi",
        ),
        additional_features=AppAdditionalFeatures(),
        variables=[],
    )


def _make_entity(entity_cls, app_mode: AppMode):
    app_config = _make_app_config(app_mode)
    return entity_cls.model_construct(
        task_id="task",
        app_config=app_config,
        model_conf=_DummyModelConf(),
        file_upload_config=None,
        conversation_id=None,
        inputs={},
        query="hello",
        files=[],
        parent_message_id=None,
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        call_depth=0,
        trace_manager=None,
    )


def _make_pipeline(
    entity_cls: type[ChatAppGenerateEntity] | type[CompletionAppGenerateEntity] = ChatAppGenerateEntity,
    app_mode: AppMode = AppMode.CHAT,
    *,
    stream: bool = True,
) -> tuple[EasyUIBasedGenerateTaskPipeline, _FakeQueueManager]:
    queue_manager = _FakeQueueManager()
    pipeline = EasyUIBasedGenerateTaskPipeline(
        application_generate_entity=_make_entity(entity_cls, app_mode),
        queue_manager=queue_manager,
        conversation=_make_conversation(app_mode),
        message=_make_message(),
        stream=stream,
    )
    return pipeline, queue_manager


def _set_queue_events(
    pipeline: EasyUIBasedGenerateTaskPipeline,
    events: Sequence[MessageQueueMessage | WorkflowQueueMessage],
) -> None:
    cast(_FakeQueueManager, pipeline.queue_manager).set_events(list(events))


def _set_method(obj: object, name: str, value: object) -> None:
    object.__setattr__(obj, name, value)


class TestEasyUiBasedGenerateTaskPipelineCoreCases:
    class TestEasyUiBasedGenerateTaskPipeline:
        def test_to_blocking_response_chat(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            pipeline._task_state.llm_result.message.content = "answer"

            def _gen():
                yield MessageEndStreamResponse(task_id="task", id="msg")

            response = pipeline._to_blocking_response(_gen())

            assert response.data.answer == "answer"

        def test_to_blocking_response_completion(self):
            conversation = _make_conversation(AppMode.COMPLETION)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(CompletionAppGenerateEntity, AppMode.COMPLETION),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            pipeline._task_state.llm_result.message.content = "answer"

            def _gen():
                yield MessageEndStreamResponse(task_id="task", id="msg")

            response = pipeline._to_blocking_response(_gen())

            assert response.data.answer == "answer"

        def test_listen_audio_msg_returns_none_when_no_publisher(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )

            assert pipeline._listen_audio_msg(publisher=None, task_id="task") is None

        def test_process_stream_response_handles_chunks_and_end(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            chunk = LLMResultChunk(
                model="mock",
                prompt_messages=[],
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(
                        content=[TextPromptMessageContent(data="hi"), TextPromptMessageContent(data="yo")]
                    ),
                ),
            )
            llm_result = LLMResult(
                model="mock",
                prompt_messages=[],
                message=AssistantPromptMessage(content="done"),
                usage=LLMUsage.empty_usage(),
            )

            events = [
                _queue_message(QueueLLMChunkEvent(chunk=chunk)),
                _queue_message(QueueMessageReplaceEvent(text="replace", reason="output_moderation")),
                _queue_message(QueuePingEvent()),
                _queue_message(QueueMessageEndEvent(llm_result=llm_result)),
            ]

            _set_queue_events(pipeline, events)

            def _message_event_type(message_id: str) -> StreamEvent:
                return StreamEvent.MESSAGE

            def _message_end() -> MessageEndStreamResponse:
                return MessageEndStreamResponse(task_id="task", id="msg")

            _set_method(pipeline._message_cycle_manager, "get_message_event_type", _message_event_type)
            _set_method(pipeline, "handle_output_moderation_when_task_finished", lambda completion: None)
            _set_method(pipeline, "_message_end_to_stream_response", _message_end)
            _set_method(pipeline, "_save_message", lambda **kwargs: None)

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def commit(self):
                    return None

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            responses = list(pipeline._process_stream_response(publisher=None))

            message_response = next(item for item in responses if isinstance(item, MessageStreamResponse))
            assert message_response.answer == "hiyo"
            replace_response = next(item for item in responses if isinstance(item, MessageReplaceStreamResponse))
            assert replace_response.answer == "replace"
            assert any(isinstance(item, PingStreamResponse) for item in responses)
            assert isinstance(responses[-1], MessageEndStreamResponse)
            assert pipeline._task_state.llm_result.message.content == "done"

        def test_handle_output_moderation_chunk_directs_output(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            class _Moderation:
                def should_direct_output(self):
                    return True

                def get_final_output(self):
                    return "final"

            _set_method(pipeline, "output_moderation_handler", _Moderation())

            result = pipeline._handle_output_moderation_chunk("token")

            assert result is True
            events = cast(_FakeQueueManager, pipeline.queue_manager).published_events
            assert any(isinstance(event, QueueLLMChunkEvent) for event in events)
            assert any(isinstance(event, QueueStopEvent) for event in events)

        def test_handle_stop_updates_usage(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            class _ModelType:
                def calc_response_usage(self, model, credentials, prompt_tokens, completion_tokens):
                    return LLMUsage.from_metadata(
                        {
                            "prompt_tokens": prompt_tokens,
                            "completion_tokens": completion_tokens,
                        }
                    )

            class _ModelConf:
                def __init__(self) -> None:
                    self.model = "mock"
                    self.credentials = {}
                    self.provider_model_bundle = _ProviderModelBundle(model_type_instance=_ModelType())

            app_config = _make_app_config(AppMode.CHAT)
            application_generate_entity = ChatAppGenerateEntity.model_construct(
                task_id="task",
                app_config=app_config,
                model_conf=_ModelConf(),
                file_upload_config=None,
                conversation_id=None,
                inputs={},
                query="hello",
                files=[],
                parent_message_id=None,
                user_id="user",
                stream=False,
                invoke_from=InvokeFrom.WEB_APP,
                extras={},
                call_depth=0,
                trace_manager=None,
            )

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=application_generate_entity,
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            pipeline._task_state.llm_result.prompt_messages = [AssistantPromptMessage(content="prompt")]
            pipeline._task_state.llm_result.message = AssistantPromptMessage(content="answer")

            calls: list[int] = []

            class _FakeModelInstance:
                def __init__(self, provider_model_bundle, model):
                    pass

                def get_llm_num_tokens(self, messages):
                    calls.append(1)
                    return 10 if len(calls) == 1 else 5

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.ModelInstance",
                _FakeModelInstance,
            )

            pipeline._handle_stop(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL))

            assert pipeline._task_state.llm_result.usage.prompt_tokens == 10
            assert pipeline._task_state.llm_result.usage.completion_tokens == 5

        def test_record_files_builds_file_payloads(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )

            message_files = [
                _message_file(
                    file_id="mf-1",
                    transfer_method=FileTransferMethod.REMOTE_URL,
                    url="http://example.com/a.png",
                    upload_file_id=None,
                ),
                _message_file(
                    file_id="mf-2",
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    url="",
                    upload_file_id="upload-1",
                ),
                _message_file(
                    file_id="mf-3",
                    transfer_method=FileTransferMethod.TOOL_FILE,
                    url="tool/file.bin",
                    upload_file_id=None,
                    file_type=FileType.CUSTOM,
                ),
            ]
            upload_files = [
                _upload_file(
                    file_id="upload-1",
                    name="local.png",
                    mime_type="image/png",
                    size=123,
                    extension="png",
                )
            ]

            class _Result:
                def __init__(self, items):
                    self._items = items

                def all(self):
                    return self._items

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    self.calls = 0

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def scalars(self, *args, **kwargs):
                    self.calls += 1
                    return _Result(message_files if self.calls == 1 else upload_files)

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
                lambda **kwargs: "signed-url",
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.message_file_utils.sign_tool_file",
                lambda **kwargs: "signed-tool",
            )

            response = pipeline._message_end_to_stream_response()
            files = response.files

            assert files
            assert len(files) == 3

        def test_process_stream_response_handles_annotation_and_error(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            agent_chunk = LLMResultChunk(
                model="mock",
                prompt_messages=[],
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(content="agent"),
                ),
            )

            events = [
                _queue_message(QueueAnnotationReplyEvent(message_annotation_id="ann")),
                _queue_message(QueueAgentThoughtEvent(agent_thought_id="thought")),
                _queue_message(QueueMessageFileEvent(message_file_id="file")),
                _queue_message(QueueAgentMessageEvent(chunk=agent_chunk)),
                _queue_message(QueueErrorEvent(error=ValueError("boom"))),
            ]

            _set_queue_events(pipeline, events)

            def _agent_thought_response(event: QueueAgentThoughtEvent) -> AgentThoughtStreamResponse:
                return AgentThoughtStreamResponse(task_id="task", id=event.agent_thought_id, position=1)

            def _file_response(event: QueueMessageFileEvent) -> MessageFileStreamResponse:
                return MessageFileStreamResponse(
                    task_id="task", id=event.message_file_id, type="image", belongs_to="user", url="file"
                )

            def _agent_message_response(answer: str, message_id: str) -> AgentMessageStreamResponse:
                return AgentMessageStreamResponse(task_id="task", id=message_id, answer=answer)

            _set_method(
                pipeline._message_cycle_manager,
                "handle_annotation_reply",
                lambda event, session: _AnnotationReply(content="annotated"),
            )
            _set_method(pipeline, "_agent_thought_to_stream_response", _agent_thought_response)
            _set_method(pipeline._message_cycle_manager, "message_file_to_stream_response", _file_response)
            _set_method(pipeline, "_agent_message_to_stream_response", _agent_message_response)
            _set_method(pipeline, "handle_error", lambda **kwargs: ValueError("boom"))
            _set_method(pipeline, "error_to_stream_response", lambda err: ErrorStreamResponse(task_id="task", err=err))

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def commit(self):
                    return None

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            responses = list(pipeline._process_stream_response(publisher=None))

            assert any(isinstance(response, AgentThoughtStreamResponse) for response in responses)
            assert any(isinstance(response, MessageFileStreamResponse) for response in responses)
            agent_response = next(
                response for response in responses if isinstance(response, AgentMessageStreamResponse)
            )
            assert agent_response.answer == "agent"
            assert isinstance(responses[-1], ErrorStreamResponse)
            assert isinstance(responses[-1].err, ValueError)
            assert pipeline._task_state.llm_result.message.content == "annotated"

        def test_process_stream_response_error_event_adds_trace_task(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            application_generate_entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
            application_generate_entity.extras = {"trace_session_id": "session-1"}

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=application_generate_entity,
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            _set_queue_events(pipeline, [_queue_message(QueueErrorEvent(error=ValueError("boom")))])
            _set_method(pipeline, "handle_error", lambda **kwargs: ValueError("boom"))
            _set_method(pipeline, "error_to_stream_response", lambda err: ErrorStreamResponse(task_id="task", err=err))

            trace_manager_double = _TraceManagerDouble()
            trace_manager = cast(TraceQueueManager, trace_manager_double)

            class _Session:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def commit(self):
                    return None

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            responses = list(pipeline._process_stream_response(publisher=None, trace_manager=trace_manager))

            assert len(responses) == 1
            assert isinstance(responses[0], ErrorStreamResponse)
            trace_manager_double.add_trace_task.assert_called_once()
            trace_task = trace_manager_double.add_trace_task.call_args.args[0]
            assert trace_task.trace_type == TraceTaskName.MESSAGE_TRACE
            assert trace_task.conversation_id == "conv"
            assert trace_task.message_id == "msg"
            assert trace_task.kwargs["trace_session_id"] == "session-1"

        def test_agent_thought_to_stream_response_returns_payload(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            agent_thought = _agent_thought()

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def scalar(self, *args, **kwargs):
                    return agent_thought

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            response = pipeline._agent_thought_to_stream_response(QueueAgentThoughtEvent(agent_thought_id="thought"))

            assert response is not None
            assert response.id == "thought"
            assert response.thought == "t"

        def test_agent_thought_to_stream_response_normalizes_null_display_fields(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()

            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            agent_thought = _agent_thought()
            agent_thought.thought = None
            agent_thought.answer = None
            agent_thought.observation = None
            agent_thought.tool = None
            agent_thought.tool_input = None
            agent_thought.message_files = None

            class _Session:
                def __init__(self, *args, **kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def scalar(self, *args, **kwargs):
                    return agent_thought

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )
            response = pipeline._agent_thought_to_stream_response(QueueAgentThoughtEvent(agent_thought_id="thought"))

            assert response is not None
            assert response.thought == ""
            assert response.observation == ""
            assert response.tool == ""
            assert response.tool_input == ""
            assert response.model_dump(mode="json")["message_files"] == []

        def test_process_routes_to_stream_and_starts_conversation_name_generation(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            pipeline._message_cycle_manager.generate_conversation_name = Mock(return_value=object())
            _set_method(
                pipeline,
                "_wrapper_process_stream_response",
                lambda trace_manager: iter([PingStreamResponse(task_id="task")]),
            )
            _set_method(pipeline, "_to_stream_response", lambda generator: "streamed")

            result = pipeline.process()

            assert result == "streamed"
            pipeline._message_cycle_manager.generate_conversation_name.assert_called_once_with(
                conversation_id="conv", query="hello", message_id="msg"
            )

        def test_process_routes_to_blocking_for_completion_mode(self):
            conversation = _make_conversation(AppMode.COMPLETION)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(CompletionAppGenerateEntity, AppMode.COMPLETION),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            pipeline._message_cycle_manager.generate_conversation_name = Mock()
            _set_method(
                pipeline,
                "_wrapper_process_stream_response",
                lambda trace_manager: iter([PingStreamResponse(task_id="task")]),
            )
            _set_method(pipeline, "_to_blocking_response", lambda generator: "blocking")

            result = pipeline.process()

            assert result == "blocking"
            pipeline._message_cycle_manager.generate_conversation_name.assert_not_called()

        def test_to_blocking_response_raises_error_stream_exception(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )

            def _gen():
                yield ErrorStreamResponse(task_id="task", err=ValueError("stream error"))

            with pytest.raises(ValueError, match="stream error"):
                pipeline._to_blocking_response(_gen())

        def test_to_blocking_response_raises_when_generator_ends_without_message_end(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )

            def _gen():
                yield PingStreamResponse(task_id="task")

            with pytest.raises(RuntimeError, match="queue listening stopped unexpectedly"):
                pipeline._to_blocking_response(_gen())

        def test_to_stream_response_wraps_completion_stream_events(self):
            conversation = _make_conversation(AppMode.COMPLETION)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(CompletionAppGenerateEntity, AppMode.COMPLETION),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            def _gen():
                yield PingStreamResponse(task_id="task")

            response = list(pipeline._to_stream_response(_gen()))[0]

            assert isinstance(response, CompletionAppStreamResponse)
            assert response.message_id == "msg"

        def test_to_stream_response_wraps_chat_stream_events(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            def _gen():
                yield PingStreamResponse(task_id="task")

            response = list(pipeline._to_stream_response(_gen()))[0]

            assert isinstance(response, ChatbotAppStreamResponse)
            assert response.conversation_id == "conv"

        def test_listen_audio_msg_returns_audio_response_for_non_finish_audio(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            publisher = cast(
                AppGeneratorTTSPublisher,
                _AudioPublisher(status="responding", audio="abc"),
            )

            response = pipeline._listen_audio_msg(publisher=publisher, task_id="task")

            assert isinstance(response, MessageAudioStreamResponse)
            assert response.audio == "abc"

        def test_listen_audio_msg_returns_none_for_finish_audio(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            publisher = cast(
                AppGeneratorTTSPublisher,
                _AudioPublisher(status="finish", audio="abc"),
            )

            assert pipeline._listen_audio_msg(publisher=publisher, task_id="task") is None

        def test_wrapper_process_stream_response_without_tts_publisher(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            payload = PingStreamResponse(task_id="task")
            _set_method(pipeline, "_process_stream_response", lambda publisher, trace_manager: iter([payload]))

            responses = list(pipeline._wrapper_process_stream_response())

            assert responses == [payload]

        def test_wrapper_process_stream_response_with_tts_publisher(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
            entity.app_config.app_model_config_dict = {
                "text_to_speech": {"autoPlay": "enabled", "enabled": True, "voice": "v", "language": "en"}
            }
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=entity,
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            class _Publisher:
                def check_and_get_audio(self, *, block=False):
                    assert block
                    return AudioTrunk("finish", "")

                def publish(self, message):
                    assert message is None

                def cancel(self):
                    return None

            inline_audio = MessageAudioStreamResponse(task_id="task", audio="inline")
            audio_calls = iter([inline_audio, None])
            payload = PingStreamResponse(task_id="task")
            _set_method(pipeline, "_listen_audio_msg", lambda publisher, task_id: next(audio_calls))
            _set_method(pipeline, "_process_stream_response", lambda publisher, trace_manager: iter([payload]))
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.AppGeneratorTTSPublisher",
                lambda tenant_id, voice, language, app_type: _Publisher(),
            )

            responses = list(pipeline._wrapper_process_stream_response())

            assert responses[0] == inline_audio
            assert responses[1] == payload
            assert isinstance(responses[-1], MessageAudioEndStreamResponse)
            assert "audio_type" not in responses[-1].model_dump()

        def test_wrapper_process_stream_response_waits_for_the_audio_terminal(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
            entity.app_config.app_model_config_dict = {
                "text_to_speech": {"autoPlay": "enabled", "enabled": True, "voice": "v", "language": "en"}
            }
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=entity,
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            class _Publisher:
                def __init__(self):
                    self._events = iter([AudioTrunk("responding", "later"), AudioTrunk("finish", "")])

                def check_and_get_audio(self, *, block=False):
                    assert block
                    return next(self._events)

                def publish(self, message):
                    assert message is None

                def cancel(self):
                    return None

            _set_method(pipeline, "_process_stream_response", lambda publisher, trace_manager: iter([]))
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.AppGeneratorTTSPublisher",
                lambda tenant_id, voice, language, app_type: _Publisher(),
            )
            responses = list(pipeline._wrapper_process_stream_response())

            assert any(isinstance(item, MessageAudioStreamResponse) for item in responses)
            assert isinstance(responses[-1], MessageAudioEndStreamResponse)

        def test_wrapper_process_stream_response_ends_audio_before_reporting_tts_error(
            self, monkeypatch: pytest.MonkeyPatch
        ):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
            entity.app_config.app_model_config_dict = {
                "text_to_speech": {"autoPlay": "enabled", "enabled": True, "voice": "v", "language": "en"}
            }
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=entity,
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            error = RuntimeError("tts failed")

            class _Publisher:
                def check_and_get_audio(self, *, block=False):
                    assert block
                    return AudioTrunk("error", b"", error=error)

                def publish(self, message):
                    assert message is None

                def cancel(self):
                    return None

            _set_method(pipeline, "_process_stream_response", lambda publisher, trace_manager: iter([]))
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.AppGeneratorTTSPublisher",
                lambda tenant_id, voice, language, app_type: _Publisher(),
            )

            responses = list(pipeline._wrapper_process_stream_response())

            assert isinstance(responses[-2], MessageAudioEndStreamResponse)
            assert isinstance(responses[-1], ErrorStreamResponse)
            assert responses[-1].err is error

        def test_wrapper_process_stream_response_ends_audio_before_a_main_error(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
            entity.app_config.app_model_config_dict = {
                "text_to_speech": {"autoPlay": "enabled", "enabled": True, "voice": "v", "language": "en"}
            }
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=entity,
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            publisher = Mock()
            publisher.check_and_get_audio.return_value = None
            error = ErrorStreamResponse(task_id="task", err=RuntimeError("generation failed"))
            _set_method(pipeline, "_process_stream_response", lambda publisher, trace_manager: iter([error]))
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.AppGeneratorTTSPublisher",
                lambda tenant_id, voice, language, app_type: publisher,
            )

            responses = list(pipeline._wrapper_process_stream_response())

            assert isinstance(responses[-2], MessageAudioEndStreamResponse)
            assert responses[-1] is error
            assert publisher.cancel.called
            publisher.publish.assert_not_called()

        def test_process_stream_response_handles_stop_event_and_output_replacement(
            self, monkeypatch: pytest.MonkeyPatch
        ):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            pipeline._task_state.llm_result.message.content = "raw answer"
            _set_queue_events(pipeline, [_queue_message(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL))])
            pipeline._handle_stop = Mock()
            _set_method(pipeline, "handle_output_moderation_when_task_finished", lambda answer: "moderated answer")
            _set_method(
                pipeline._message_cycle_manager,
                "message_replace_to_stream_response",
                lambda answer: MessageReplaceStreamResponse(task_id="task", answer=answer, reason=""),
            )
            _set_method(pipeline, "_save_message", lambda **kwargs: None)
            _set_method(
                pipeline,
                "_message_end_to_stream_response",
                lambda: MessageEndStreamResponse(task_id="task", id="msg"),
            )

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def commit(self):
                    return None

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            responses = list(pipeline._process_stream_response(publisher=None))

            assert isinstance(responses[0], MessageReplaceStreamResponse)
            assert responses[0].answer == "moderated answer"
            assert isinstance(responses[1], MessageEndStreamResponse)
            pipeline._handle_stop.assert_called_once()

        def test_process_stream_response_handles_retriever_unknown_and_empty_chunk(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            retriever_event = QueueRetrieverResourcesEvent(retriever_resources=[])
            chunk = LLMResultChunk(
                model="mock",
                prompt_messages=[],
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=None)),
            )
            handled = {"retriever": 0}

            def _handle_retriever_resources(event):
                handled["retriever"] += 1

            pipeline._message_cycle_manager.handle_retriever_resources = _handle_retriever_resources
            _set_queue_events(
                pipeline,
                [
                    _queue_message(retriever_event),
                    _unknown_queue_message(),
                    _queue_message(QueueLLMChunkEvent(chunk=chunk)),
                ],
            )

            responses = list(pipeline._process_stream_response(publisher=None))

            assert responses == []
            assert handled["retriever"] == 1

        def test_process_stream_response_skips_when_output_moderation_directs_chunk(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            chunk = LLMResultChunk(
                model="mock",
                prompt_messages=[],
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="x")),
            )
            pipeline._handle_output_moderation_chunk = lambda text: True
            _set_queue_events(pipeline, [_queue_message(QueueLLMChunkEvent(chunk=chunk))])

            responses = list(pipeline._process_stream_response(publisher=None))

            assert responses == []

        def test_process_stream_response_ignores_unsupported_chunk_content_types(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            chunk = LLMResultChunk.model_construct(
                prompt_messages=[],
                delta=LLMResultChunkDelta.model_construct(
                    message=AssistantPromptMessage.model_construct(content=[object(), "ok"])
                ),
            )
            _set_method(
                pipeline._message_cycle_manager, "get_message_event_type", lambda message_id: StreamEvent.MESSAGE
            )
            _set_queue_events(pipeline, [_queue_message(QueueLLMChunkEvent.model_construct(chunk=chunk))])

            responses = list(pipeline._process_stream_response(publisher=None))

            assert len(responses) == 1
            assert isinstance(responses[0], MessageStreamResponse)
            assert responses[0].answer == "ok"
            assert pipeline._task_state.llm_result.message.content == "ok"

        def test_process_stream_response_skips_none_chunk_content(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            chunk = LLMResultChunk(
                model="mock",
                prompt_messages=[],
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=None)),
            )
            pipeline._message_cycle_manager.message_to_stream_response = Mock()
            _set_queue_events(pipeline, [_queue_message(QueueLLMChunkEvent(chunk=chunk))])

            responses = list(pipeline._process_stream_response(publisher=None))

            assert responses == []
            pipeline._message_cycle_manager.message_to_stream_response.assert_not_called()
            assert pipeline._task_state.llm_result.message.content == ""

        def test_process_stream_response_reaches_post_loop_branch_with_thread_reference(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            pipeline._conversation_name_generate_thread = Thread()
            _set_queue_events(pipeline, [])

            assert list(pipeline._process_stream_response(publisher=None)) == []

        def test_save_message_persists_fields_and_emits_trace(
            self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
        ):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            application_generate_entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
            application_generate_entity.extras = {"trace_session_id": "session-1"}
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=application_generate_entity,
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            pipeline.start_at = 10.0
            _set_method(pipeline, "_model_config", _ModelConfigMode(mode="chat"))
            pipeline._task_state.llm_result.prompt_messages = [AssistantPromptMessage(content="prompt")]
            pipeline._task_state.llm_result.message = AssistantPromptMessage(content="  {{name}} hello  ")
            pipeline._task_state.llm_result.usage = LLMUsage.from_metadata(
                {"prompt_tokens": 3, "completion_tokens": 5, "total_price": "1.23"}
            )

            message_obj = _make_message()
            conversation_obj = _make_conversation(AppMode.CHAT)
            session = sqlite_session
            session.add_all([conversation_obj, message_obj])
            session.flush()
            trace_manager_double = _TraceManagerDouble()
            trace_manager = cast(TraceQueueManager, trace_manager_double)
            sent_payloads: list[tuple[tuple[object, ...], dict[str, object]]] = []

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.PromptMessageUtil.prompt_messages_to_prompt_for_saving",
                lambda mode, prompt_messages: "serialized-prompt",
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.PromptTemplateParser.remove_template_variables",
                lambda text: text.replace("{{name}}", "").strip(),
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.naive_utc_now",
                lambda: datetime(2024, 1, 1, tzinfo=UTC),
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.time.perf_counter", lambda: 15.0
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.message_was_created.send",
                lambda *args, **kwargs: sent_payloads.append((args, kwargs)),
            )

            pipeline._save_message(session=session, trace_manager=trace_manager)

            assert message_obj.message == "serialized-prompt"
            assert message_obj.answer == "hello"
            assert message_obj.provider_response_latency == 5.0
            trace_manager_double.add_trace_task.assert_called_once()
            trace_task = trace_manager_double.add_trace_task.call_args.args[0]
            assert trace_task.trace_type == TraceTaskName.MESSAGE_TRACE
            assert trace_task.conversation_id == "conv"
            assert trace_task.message_id == "msg"
            assert trace_task.kwargs["trace_session_id"] == "session-1"
            assert len(sent_payloads) == 1

        def test_save_stopped_message_preserves_backend_reported_usage(
            self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
        ) -> None:
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=_make_conversation(AppMode.CHAT),
                message=_make_message(),
                stream=True,
            )
            _set_method(pipeline, "_model_config", _ModelConfigMode(mode="chat"))
            pipeline._task_state.llm_result.usage = LLMUsage.empty_usage()

            message = _make_message()
            message.message_tokens = 13
            message.answer_tokens = 8
            message.total_price = Decimal("0.21")
            message.message_metadata = json.dumps({"usage": {"total_tokens": 21}})
            sqlite_session.add_all([_make_conversation(AppMode.CHAT), message])
            sqlite_session.flush()
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.PromptMessageUtil.prompt_messages_to_prompt_for_saving",
                lambda _mode, _prompt_messages: "",
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.message_was_created.send",
                lambda *_args, **_kwargs: None,
            )

            pipeline._save_message(session=sqlite_session, preserve_existing_usage=True)

            assert message.message_tokens == 13
            assert message.answer_tokens == 8
            assert message.total_price == Decimal("0.21")
            assert message.message_metadata is not None
            assert json.loads(message.message_metadata)["usage"]["total_tokens"] == 21

        @pytest.mark.parametrize("metadata", ["{", "[]"])
        def test_save_stopped_message_recovers_invalid_existing_metadata(
            self,
            metadata: str,
            monkeypatch: pytest.MonkeyPatch,
            sqlite_session: Session,
        ) -> None:
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=_make_conversation(AppMode.CHAT),
                message=_make_message(),
                stream=True,
            )
            _set_method(pipeline, "_model_config", _ModelConfigMode(mode="chat"))
            pipeline._task_state.llm_result.usage = LLMUsage.empty_usage()

            message = _make_message()
            message.message_tokens = 13
            message.answer_tokens = 8
            message.total_price = Decimal("0.21")
            message.message_metadata = metadata
            sqlite_session.add_all([_make_conversation(AppMode.CHAT), message])
            sqlite_session.flush()
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.PromptMessageUtil.prompt_messages_to_prompt_for_saving",
                lambda _mode, _prompt_messages: "",
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.message_was_created.send",
                lambda *_args, **_kwargs: None,
            )

            pipeline._save_message(session=sqlite_session, preserve_existing_usage=True)

            assert message.message_tokens == 13
            assert message.answer_tokens == 8
            assert message.total_price == Decimal("0.21")

        def test_save_message_raises_when_message_not_found(self, sqlite_session: Session):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            session = sqlite_session

            with pytest.raises(ValueError, match="message msg not found"):
                pipeline._save_message(session=session)

        def test_save_message_raises_when_conversation_not_found(self, sqlite_session: Session):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            session = sqlite_session
            session.add(_make_message())
            session.flush()

            with pytest.raises(ValueError, match="Conversation conv not found"):
                pipeline._save_message(session=session)

        def test_message_end_to_stream_response_includes_usage_metadata(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            pipeline._task_state.llm_result.usage = LLMUsage.from_metadata({"prompt_tokens": 1, "completion_tokens": 2})

            class _Result:
                def all(self):
                    return []

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def scalars(self, *args, **kwargs):
                    return _Result()

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            response = pipeline._message_end_to_stream_response()

            assert response.id == "msg"
            usage_metadata = cast(dict[str, object], response.metadata["usage"])
            assert usage_metadata["prompt_tokens"] == 1

        def test_record_files_returns_empty_list_when_message_has_no_files(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )

            class _Result:
                def all(self):
                    return []

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def scalars(self, *args, **kwargs):
                    return _Result()

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            response = pipeline._message_end_to_stream_response()

            assert response.files == []

        def test_record_files_handles_local_fallback_and_tool_url_variants(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=False,
            )
            message_files = [
                _message_file(
                    file_id="mf-local-fallback",
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    url="",
                    upload_file_id="upload-missing",
                    file_type=FileType.CUSTOM,
                ),
                _message_file(
                    file_id="mf-tool-http",
                    transfer_method=FileTransferMethod.TOOL_FILE,
                    url="http://cdn.example.com/file.txt?x=1",
                    upload_file_id=None,
                    file_type=FileType.CUSTOM,
                ),
                _message_file(
                    file_id="mf-tool-noext",
                    transfer_method=FileTransferMethod.TOOL_FILE,
                    url="tool/path/toolid",
                    upload_file_id=None,
                    file_type=FileType.CUSTOM,
                ),
            ]

            class _Result:
                def __init__(self, items):
                    self._items = items

                def all(self):
                    return self._items

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    self.calls = 0

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def scalars(self, *args, **kwargs):
                    self.calls += 1
                    return _Result(message_files if self.calls == 1 else [])

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
                lambda **kwargs: "local-fallback-signed",
            )
            monkeypatch.setattr(
                "core.app.task_pipeline.message_file_utils.sign_tool_file",
                lambda **kwargs: "tool-signed",
            )

            response = pipeline._message_end_to_stream_response()
            files = response.files

            assert files is not None
            assert files[0]["url"] == "local-fallback-signed"
            assert files[1]["filename"] == "file.txt"
            assert files[2]["extension"] == ".bin"

        def test_agent_message_to_stream_response_builds_payload(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            response = pipeline._agent_message_to_stream_response(answer="hello", message_id="msg")

            assert response.id == "msg"
            assert response.answer == "hello"

        def test_agent_thought_to_stream_response_returns_none_when_not_found(self, monkeypatch: pytest.MonkeyPatch):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )

            class _Session:
                def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def scalar(self, *args, **kwargs):
                    return None

            monkeypatch.setattr(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.session_factory.create_session",
                lambda: _Session(),
            )

            response = pipeline._agent_thought_to_stream_response(QueueAgentThoughtEvent(agent_thought_id="missing"))

            assert response is None

        def test_handle_output_moderation_chunk_appends_token_when_not_directing(self):
            conversation = _make_conversation(AppMode.CHAT)
            message = _make_message()
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
                queue_manager=_FakeQueueManager(),
                conversation=conversation,
                message=message,
                stream=True,
            )
            appended_tokens: list[str] = []

            class _Moderation:
                def should_direct_output(self):
                    return False

                def append_new_token(self, text):
                    appended_tokens.append(text)

            _set_method(pipeline, "output_moderation_handler", _Moderation())

            result = pipeline._handle_output_moderation_chunk("next-token")

            assert result is False
            assert appended_tokens == ["next-token"]


"""Exercise message-end file serialization against persisted SQLite rows.

The suite covers empty results, all transfer methods, upload metadata batching,
and the fallback used when a local message file references a missing upload.
"""


SQLITE_MODELS = (MessageFile, UploadFile)


class TestEasyUiMessageEndFilesCases:
    pytestmark = [
        pytest.mark.usefixtures("sqlite_session"),
        pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
    ]

    class TestMessageEndStreamResponseFiles:
        """Verify message-end file payloads from actual ORM query results."""

        @pytest.fixture(autouse=True)
        def bind_sqlite_engine(
            self, sqlite_engine: _easy_ui_message_end_files_Engine, monkeypatch: pytest.MonkeyPatch
        ) -> None:
            """Bind sessions opened by the pipeline to the per-test SQLite engine."""

            sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
            monkeypatch.setattr("core.db.session_factory._session_maker", sqlite_session_maker)

        @pytest.fixture
        def pipeline(
            self, monkeypatch: pytest.MonkeyPatch, redis_transport: tuple[RedisClientWrapper, MagicMock]
        ) -> EasyUIBasedGenerateTaskPipeline:
            """Construct the pipeline with validated request, model, and task state."""
            monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", redis_transport[0])
            request = ChatAppGenerateEntity(
                task_id=str(uuid.uuid4()),
                app_config=EasyUIBasedAppConfig(
                    tenant_id="tenant-id",
                    app_id="app-id",
                    app_mode=AppMode.CHAT,
                    app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
                    app_model_config_dict={},
                    model=ModelConfigEntity(provider="test-provider", model="test-model"),
                    prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
                ),
                model_conf=make_model_config(provider="test-provider", model="test-model", mode="chat"),
                inputs={},
                files=[],
                user_id="user-id",
                stream=True,
                invoke_from=InvokeFrom.WEB_APP,
            )
            conversation = Conversation(
                id=str(uuid.uuid4()),
                app_id="app-id",
                mode=AppMode.CHAT,
                name="Conversation",
                from_source=ConversationFromSource.API,
                inputs={},
            )
            message = Message(id=str(uuid.uuid4()), created_at=datetime.now())
            queue = MessageBasedAppQueueManager(
                task_id=request.task_id,
                user_id=request.user_id,
                invoke_from=request.invoke_from,
                conversation_id=conversation.id,
                app_mode=AppMode.CHAT,
                message_id=message.id,
            )
            return EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=request,
                queue_manager=queue,
                conversation=conversation,
                message=message,
                stream=True,
            )

        @staticmethod
        def _message_file(
            *,
            transfer_method: FileTransferMethod,
            url: str | None = None,
            upload_file_id: str | None = None,
        ) -> MessageFile:
            return MessageFile(
                message_id=str(uuid.uuid4()),
                type=FileType.IMAGE,
                transfer_method=transfer_method,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid.uuid4()),
                url=url,
                upload_file_id=upload_file_id,
            )

        @pytest.fixture
        def message_file_local(self) -> MessageFile:
            """Create an unpersisted local-file row."""

            return self._message_file(
                transfer_method=FileTransferMethod.LOCAL_FILE,
                upload_file_id=str(uuid.uuid4()),
            )

        @pytest.fixture
        def message_file_remote(self) -> MessageFile:
            """Create an unpersisted remote-file row."""

            return self._message_file(
                transfer_method=FileTransferMethod.REMOTE_URL,
                url="https://example.com/image.jpg",
            )

        @pytest.fixture
        def message_file_tool(self) -> MessageFile:
            """Create an unpersisted tool-file row."""

            return self._message_file(
                transfer_method=FileTransferMethod.TOOL_FILE,
                url="tool_file_123.png",
            )

        @pytest.fixture
        def upload_file(self, message_file_local: MessageFile) -> UploadFile:
            """Create upload metadata matching the local message-file reference."""

            upload = UploadFile(
                tenant_id=str(uuid.uuid4()),
                storage_type=StorageType.LOCAL,
                key="uploads/test_image.png",
                name="test_image.png",
                size=1024,
                extension="png",
                mime_type="image/png",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid.uuid4()),
                created_at=datetime.now(),
                used=True,
            )
            upload.id = message_file_local.upload_file_id or str(uuid.uuid4())
            return upload

        @staticmethod
        def _persist(session: Session, *rows: MessageFile | UploadFile) -> None:
            session.add_all(rows)
            session.commit()

        def test_message_end_with_no_files(
            self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline
        ) -> None:
            """Rows for another message do not leak into an empty files array."""

            unrelated_file = self._message_file(
                transfer_method=FileTransferMethod.REMOTE_URL,
                url="https://example.com/unrelated.png",
            )
            self._persist(sqlite_session, unrelated_file)

            result = pipeline._message_end_to_stream_response()

            assert sqlite_session.get(MessageFile, unrelated_file.id) is unrelated_file
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files == []
            assert result.id == pipeline._message_id
            assert result.metadata == {
                "usage": pipeline._task_state.llm_result.usage.model_dump(exclude_none=True),
                "retriever_resources": [],
                "reasoning": {},
            }

        def test_message_end_with_local_file(
            self,
            sqlite_session: Session,
            pipeline: EasyUIBasedGenerateTaskPipeline,
            message_file_local: MessageFile,
            upload_file: UploadFile,
        ) -> None:
            """Local files include persisted upload metadata and a signed URL."""

            message_file_local.message_id = pipeline._message_id
            self._persist(sqlite_session, message_file_local, upload_file)

            with patch(
                "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
                return_value="https://example.com/signed-url?signature=abc123",
            ) as get_signed_url:
                result = pipeline._message_end_to_stream_response()

            assert result.files is not None
            assert len(result.files) == 1
            file_dict = result.files[0]
            assert file_dict["related_id"] == message_file_local.id
            assert file_dict["filename"] == "test_image.png"
            assert file_dict["mime_type"] == "image/png"
            assert file_dict["size"] == 1024
            assert file_dict["extension"] == ".png"
            assert file_dict["type"] == "image"
            assert file_dict["transfer_method"] == FileTransferMethod.LOCAL_FILE.value
            assert file_dict["url"].startswith("https://example.com/signed-url")
            assert file_dict["upload_file_id"] == message_file_local.upload_file_id
            assert file_dict["remote_url"] == ""
            get_signed_url.assert_called_once_with(upload_file_id=upload_file.id)

        def test_message_end_with_remote_url(
            self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_remote: MessageFile
        ) -> None:
            """Remote files retain their source URL and derived filename."""

            message_file_remote.message_id = pipeline._message_id
            self._persist(sqlite_session, message_file_remote)

            result = pipeline._message_end_to_stream_response()

            assert result.files is not None
            assert len(result.files) == 1
            file_dict = result.files[0]
            assert file_dict["related_id"] == message_file_remote.id
            assert file_dict["filename"] == "image.jpg"
            assert file_dict["url"] == "https://example.com/image.jpg"
            assert file_dict["extension"] == ".jpg"
            assert file_dict["type"] == "image"
            assert file_dict["transfer_method"] == FileTransferMethod.REMOTE_URL.value
            assert file_dict["remote_url"] == "https://example.com/image.jpg"
            assert file_dict["upload_file_id"] == message_file_remote.id

        def test_message_end_with_tool_file_http(
            self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_tool: MessageFile
        ) -> None:
            """HTTP tool-file URLs pass through unchanged."""

            message_file_tool.message_id = pipeline._message_id
            message_file_tool.url = "https://example.com/tool_file.png"
            self._persist(sqlite_session, message_file_tool)

            result = pipeline._message_end_to_stream_response()

            assert result.files is not None
            file_dict = result.files[0]
            assert file_dict["url"] == "https://example.com/tool_file.png"
            assert file_dict["filename"] == "tool_file.png"
            assert file_dict["extension"] == ".png"
            assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value

        def test_message_end_with_tool_file_local(
            self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_tool: MessageFile
        ) -> None:
            """Local tool-file identifiers are signed at the external boundary."""

            message_file_tool.message_id = pipeline._message_id
            self._persist(sqlite_session, message_file_tool)

            with patch(
                "core.app.task_pipeline.message_file_utils.sign_tool_file",
                return_value="https://example.com/signed-tool-file.png?signature=xyz",
            ) as sign_tool:
                result = pipeline._message_end_to_stream_response()

            assert result.files is not None
            file_dict = result.files[0]
            assert file_dict["url"].startswith("https://example.com/signed-tool-file.png")
            assert file_dict["filename"] == "tool_file_123.png"
            assert file_dict["extension"] == ".png"
            assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value
            sign_tool.assert_called_once_with(tool_file_id="tool_file_123", extension=".png")

        def test_message_end_with_tool_file_long_extension(
            self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_tool: MessageFile
        ) -> None:
            """Overlong tool-file extensions use the safe binary fallback."""

            message_file_tool.message_id = pipeline._message_id
            message_file_tool.url = "tool_file_abc.verylongextension"
            self._persist(sqlite_session, message_file_tool)

            with patch(
                "core.app.task_pipeline.message_file_utils.sign_tool_file",
                return_value="https://example.com/signed.bin",
            ) as sign_tool:
                result = pipeline._message_end_to_stream_response()

            assert result.files is not None
            assert result.files[0]["extension"] == ".bin"
            sign_tool.assert_called_once_with(tool_file_id="tool_file_abc", extension=".bin")

        def test_message_end_with_multiple_files(
            self,
            sqlite_session: Session,
            pipeline: EasyUIBasedGenerateTaskPipeline,
            message_file_local: MessageFile,
            message_file_remote: MessageFile,
            upload_file: UploadFile,
        ) -> None:
            """The response contains every persisted file associated with the message."""

            message_file_local.message_id = pipeline._message_id
            message_file_remote.message_id = pipeline._message_id
            self._persist(sqlite_session, message_file_local, message_file_remote, upload_file)

            with patch(
                "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
                return_value="https://example.com/signed-url?signature=abc123",
            ):
                result = pipeline._message_end_to_stream_response()

            assert result.files is not None
            assert {file["related_id"] for file in result.files} == {message_file_local.id, message_file_remote.id}

        def test_message_end_with_local_file_no_upload_file(
            self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_local: MessageFile
        ) -> None:
            """A missing upload row still signs the stored upload identifier."""

            message_file_local.message_id = pipeline._message_id
            self._persist(sqlite_session, message_file_local)

            with patch(
                "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
                return_value="https://example.com/fallback-url?signature=def456",
            ) as get_signed_url:
                result = pipeline._message_end_to_stream_response()

            assert result.files is not None
            assert len(result.files) == 1
            assert result.files[0]["url"].startswith("https://example.com/fallback-url")
            get_signed_url.assert_called_once_with(upload_file_id=str(message_file_local.upload_file_id))
