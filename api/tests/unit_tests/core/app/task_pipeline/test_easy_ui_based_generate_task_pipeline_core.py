from __future__ import annotations

from collections.abc import Generator, Sequence
from datetime import UTC, datetime
from threading import Thread
from typing import cast
from unittest.mock import Mock

import pytest

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
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
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, TextPromptMessageContent
from models.enums import CreatorUserRole
from models.model import AppMode, Conversation, Message, MessageAgentThought, MessageFile, UploadFile


class _DummyModelConf:
    def __init__(self) -> None:
        self.model = "mock"


class _FakeDb:
    engine: object = object()


class _UnknownQueueEvent:
    pass


class _AnnotationReply:
    def __init__(self, content: str) -> None:
        self.content = content


class _ModelConfigMode:
    def __init__(self, mode: str) -> None:
        self.mode = mode


class _ProviderModelBundle:
    def __init__(self, model_type_instance: object) -> None:
        self.model_type_instance = model_type_instance


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
    conversation = Conversation()
    conversation.id = "conv"
    conversation.mode = app_mode
    return conversation


def _make_message() -> Message:
    message = Message()
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
    upload_file = UploadFile(
        tenant_id="tenant",
        storage_type=StorageType.LOCAL,
        key=f"uploads/{file_id}",
        name=name,
        size=size,
        extension=extension,
        mime_type=mime_type,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user",
        created_at=datetime.now(UTC),
        used=False,
    )
    upload_file.id = file_id
    return upload_file


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
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def commit(self):
                return None

        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session",
            _Session,
        )
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
            def __init__(self, *args, **kwargs):
                self.calls = 0

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def scalars(self, *args, **kwargs):
                self.calls += 1
                return _Result(message_files if self.calls == 1 else upload_files)

        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session",
            _Session,
        )
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
            lambda event: _AnnotationReply(content="annotated"),
        )
        _set_method(pipeline, "_agent_thought_to_stream_response", _agent_thought_response)
        _set_method(pipeline._message_cycle_manager, "message_file_to_stream_response", _file_response)
        _set_method(pipeline, "_agent_message_to_stream_response", _agent_message_response)
        _set_method(pipeline, "handle_error", lambda **kwargs: ValueError("boom"))
        _set_method(pipeline, "error_to_stream_response", lambda err: ErrorStreamResponse(task_id="task", err=err))

        class _Session:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def commit(self):
                return None

        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session",
            _Session,
        )
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
        )

        responses = list(pipeline._process_stream_response(publisher=None))

        assert any(isinstance(response, AgentThoughtStreamResponse) for response in responses)
        assert any(isinstance(response, MessageFileStreamResponse) for response in responses)
        agent_response = next(response for response in responses if isinstance(response, AgentMessageStreamResponse))
        assert agent_response.answer == "agent"
        assert isinstance(responses[-1], ErrorStreamResponse)
        assert isinstance(responses[-1].err, ValueError)
        assert pipeline._task_state.llm_result.message.content == "annotatedagent"

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
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def scalar(self, *args, **kwargs):
                return agent_thought

        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session",
            _Session,
        )
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
        )

        response = pipeline._agent_thought_to_stream_response(QueueAgentThoughtEvent(agent_thought_id="thought"))

        assert response is not None
        assert response.id == "thought"

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
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session",
            _Session,
        )
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
            conversation_id="conv", query="hello"
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
            def check_and_get_audio(self):
                return AudioTrunk("finish", "")

        inline_audio = MessageAudioStreamResponse(task_id="task", audio="inline")
        audio_calls = iter([inline_audio, None])
        payload = PingStreamResponse(task_id="task")
        _set_method(pipeline, "_listen_audio_msg", lambda publisher, task_id: next(audio_calls))
        _set_method(pipeline, "_process_stream_response", lambda publisher, trace_manager: iter([payload]))
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.AppGeneratorTTSPublisher",
            lambda tenant_id, voice, language: _Publisher(),
        )

        responses = list(pipeline._wrapper_process_stream_response())

        assert responses[0] == inline_audio
        assert responses[1] == payload
        assert isinstance(responses[-1], MessageAudioEndStreamResponse)

    def test_wrapper_process_stream_response_timeout_yields_audio_chunk(self, monkeypatch: pytest.MonkeyPatch):
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
                self._events = iter([None, AudioTrunk("responding", "later"), AudioTrunk("finish", "")])

            def check_and_get_audio(self):
                return next(self._events)

        clock = {"value": 0.0}

        def _fake_time():
            clock["value"] += 0.1
            return clock["value"]

        _set_method(pipeline, "_process_stream_response", lambda publisher, trace_manager: iter([]))
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.AppGeneratorTTSPublisher",
            lambda tenant_id, voice, language: _Publisher(),
        )
        monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.time.time", _fake_time)
        monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.time.sleep", lambda _: None)

        responses = list(pipeline._wrapper_process_stream_response())

        assert any(isinstance(item, MessageAudioStreamResponse) for item in responses)
        assert isinstance(responses[-1], MessageAudioEndStreamResponse)

    def test_process_stream_response_handles_stop_event_and_output_replacement(self, monkeypatch: pytest.MonkeyPatch):
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
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def commit(self):
                return None

        monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session", _Session)
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
        _set_method(pipeline._message_cycle_manager, "get_message_event_type", lambda message_id: StreamEvent.MESSAGE)
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

    def test_save_message_persists_fields_and_emits_trace(self, monkeypatch: pytest.MonkeyPatch):
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
        session = Mock()
        session.scalar.side_effect = [message_obj, conversation_obj]
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

    def test_save_message_raises_when_message_not_found(self):
        conversation = _make_conversation(AppMode.CHAT)
        message = _make_message()
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=_FakeQueueManager(),
            conversation=conversation,
            message=message,
            stream=False,
        )
        session = Mock()
        session.scalar.return_value = None

        with pytest.raises(ValueError, match="message msg not found"):
            pipeline._save_message(session=session)

    def test_save_message_raises_when_conversation_not_found(self):
        conversation = _make_conversation(AppMode.CHAT)
        message = _make_message()
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=_FakeQueueManager(),
            conversation=conversation,
            message=message,
            stream=False,
        )
        session = Mock()
        session.scalar.side_effect = [_make_message(), None]

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
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def scalars(self, *args, **kwargs):
                return _Result()

        monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session", _Session)
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def scalars(self, *args, **kwargs):
                return _Result()

        monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session", _Session)
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
            def __init__(self, *args, **kwargs):
                self.calls = 0

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def scalars(self, *args, **kwargs):
                self.calls += 1
                return _Result(message_files if self.calls == 1 else [])

        monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session", _Session)
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def scalar(self, *args, **kwargs):
                return None

        monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session", _Session)
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db",
            _FakeDb(),
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
