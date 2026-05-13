from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, CompletionAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
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
)
from core.app.entities.task_entities import (
    ChatbotAppStreamResponse,
    CompletionAppStreamResponse,
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    PingStreamResponse,
)
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.base.tts import AudioTrunk
from graphon.file import FileTransferMethod
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, TextPromptMessageContent
from models.model import AppMode


class _DummyModelConf:
    def __init__(self) -> None:
        self.model = "mock"


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


class TestEasyUiBasedGenerateTaskPipeline:
    def test_to_blocking_response_chat(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.COMPLETION)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(CompletionAppGenerateEntity, AppMode.COMPLETION),
            queue_manager=SimpleNamespace(),
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )

        assert pipeline._listen_audio_msg(publisher=None, task_id="task") is None

    def test_process_stream_response_handles_chunks_and_end(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
            SimpleNamespace(event=QueueLLMChunkEvent(chunk=chunk)),
            SimpleNamespace(event=QueueMessageReplaceEvent(text="replace", reason="output_moderation")),
            SimpleNamespace(event=QueuePingEvent()),
            SimpleNamespace(event=QueueMessageEndEvent(llm_result=llm_result)),
        ]

        pipeline.queue_manager.listen = lambda: iter(events)
        pipeline._message_cycle_manager.get_message_event_type = lambda message_id: None
        pipeline._message_cycle_manager.message_to_stream_response = lambda **kwargs: "chunk"
        pipeline._message_cycle_manager.message_replace_to_stream_response = lambda **kwargs: "replace"
        pipeline.handle_output_moderation_when_task_finished = lambda completion: None
        pipeline._message_end_to_stream_response = lambda: "end"
        pipeline._save_message = lambda **kwargs: None

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
            SimpleNamespace(engine=object()),
        )

        responses = list(pipeline._process_stream_response(publisher=None))

        assert "chunk" in responses
        assert "replace" in responses
        assert any(isinstance(item, PingStreamResponse) for item in responses)
        assert responses[-1] == "end"

    def test_handle_output_moderation_chunk_directs_output(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        events: list[object] = []

        class _Moderation:
            def should_direct_output(self):
                return True

            def get_final_output(self):
                return "final"

        pipeline.output_moderation_handler = _Moderation()
        pipeline.queue_manager.publish = lambda event, publish_from: events.append(event)

        result = pipeline._handle_output_moderation_chunk("token")

        assert result is True
        assert any(isinstance(event, QueueLLMChunkEvent) for event in events)
        assert any(isinstance(event, QueueStopEvent) for event in events)

    def test_handle_stop_updates_usage(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

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
                self.provider_model_bundle = SimpleNamespace(model_type_instance=_ModelType())

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
            queue_manager=SimpleNamespace(),
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )

        message_files = [
            SimpleNamespace(
                id="mf-1",
                message_id="msg",
                transfer_method=FileTransferMethod.REMOTE_URL,
                url="http://example.com/a.png",
                upload_file_id=None,
                type="image",
            ),
            SimpleNamespace(
                id="mf-2",
                message_id="msg",
                transfer_method=FileTransferMethod.LOCAL_FILE,
                url="",
                upload_file_id="upload-1",
                type="image",
            ),
            SimpleNamespace(
                id="mf-3",
                message_id="msg",
                transfer_method=FileTransferMethod.TOOL_FILE,
                url="tool/file.bin",
                upload_file_id=None,
                type="file",
            ),
        ]
        upload_files = [
            SimpleNamespace(
                id="upload-1",
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
            SimpleNamespace(engine=object()),
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
            SimpleNamespace(event=QueueAnnotationReplyEvent(message_annotation_id="ann")),
            SimpleNamespace(event=QueueAgentThoughtEvent(agent_thought_id="thought")),
            SimpleNamespace(event=QueueMessageFileEvent(message_file_id="file")),
            SimpleNamespace(event=QueueAgentMessageEvent(chunk=agent_chunk)),
            SimpleNamespace(event=QueueErrorEvent(error=ValueError("boom"))),
        ]

        pipeline.queue_manager.listen = lambda: iter(events)
        pipeline._message_cycle_manager.handle_annotation_reply = lambda event: SimpleNamespace(content="annotated")
        pipeline._agent_thought_to_stream_response = lambda event: "thought"
        pipeline._message_cycle_manager.message_file_to_stream_response = lambda event: "file"
        pipeline._agent_message_to_stream_response = lambda **kwargs: "agent"
        pipeline.handle_error = lambda **kwargs: ValueError("boom")
        pipeline.error_to_stream_response = lambda err: err

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
            SimpleNamespace(engine=object()),
        )

        responses = list(pipeline._process_stream_response(publisher=None))

        assert "thought" in responses
        assert "file" in responses
        assert "agent" in responses
        assert isinstance(responses[-1], ValueError)
        assert pipeline._task_state.llm_result.message.content == "annotatedagent"

    def test_agent_thought_to_stream_response_returns_payload(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))

        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )

        agent_thought = SimpleNamespace(
            id="thought",
            position=1,
            thought="t",
            observation="o",
            tool="tool",
            tool_labels={},
            tool_input="input",
            files=[],
        )

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
            SimpleNamespace(engine=object()),
        )

        response = pipeline._agent_thought_to_stream_response(QueueAgentThoughtEvent(agent_thought_id="thought"))

        assert response is not None
        assert response.id == "thought"

    def test_process_routes_to_stream_and_starts_conversation_name_generation(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        pipeline._message_cycle_manager.generate_conversation_name = Mock(return_value=object())
        pipeline._wrapper_process_stream_response = lambda trace_manager: iter(["payload"])
        pipeline._to_stream_response = lambda generator: "streamed"

        result = pipeline.process()

        assert result == "streamed"
        pipeline._message_cycle_manager.generate_conversation_name.assert_called_once_with(
            conversation_id="conv", query="hello"
        )

    def test_process_routes_to_blocking_for_completion_mode(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.COMPLETION)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(CompletionAppGenerateEntity, AppMode.COMPLETION),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )
        pipeline._message_cycle_manager.generate_conversation_name = Mock()
        pipeline._wrapper_process_stream_response = lambda trace_manager: iter(["payload"])
        pipeline._to_blocking_response = lambda generator: "blocking"

        result = pipeline.process()

        assert result == "blocking"
        pipeline._message_cycle_manager.generate_conversation_name.assert_not_called()

    def test_to_blocking_response_raises_error_stream_exception(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )

        def _gen():
            yield ErrorStreamResponse(task_id="task", err=ValueError("stream error"))

        with pytest.raises(ValueError, match="stream error"):
            pipeline._to_blocking_response(_gen())

    def test_to_blocking_response_raises_when_generator_ends_without_message_end(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )

        def _gen():
            yield PingStreamResponse(task_id="task")

        with pytest.raises(RuntimeError, match="queue listening stopped unexpectedly"):
            pipeline._to_blocking_response(_gen())

    def test_to_stream_response_wraps_completion_stream_events(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.COMPLETION)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(CompletionAppGenerateEntity, AppMode.COMPLETION),
            queue_manager=SimpleNamespace(),
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        publisher = SimpleNamespace(check_and_get_audio=lambda: AudioTrunk("responding", "abc"))

        response = pipeline._listen_audio_msg(publisher=publisher, task_id="task")

        assert isinstance(response, MessageAudioStreamResponse)
        assert response.audio == "abc"

    def test_listen_audio_msg_returns_none_for_finish_audio(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        publisher = SimpleNamespace(check_and_get_audio=lambda: AudioTrunk("finish", "abc"))

        assert pipeline._listen_audio_msg(publisher=publisher, task_id="task") is None

    def test_wrapper_process_stream_response_without_tts_publisher(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        pipeline._process_stream_response = lambda publisher, trace_manager: iter(["payload"])

        responses = list(pipeline._wrapper_process_stream_response())

        assert responses == ["payload"]

    def test_wrapper_process_stream_response_with_tts_publisher(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
        entity.app_config.app_model_config_dict = {
            "text_to_speech": {"autoPlay": "enabled", "enabled": True, "voice": "v", "language": "en"}
        }
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=entity,
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )

        class _Publisher:
            def check_and_get_audio(self):
                return AudioTrunk("finish", "")

        inline_audio = MessageAudioStreamResponse(task_id="task", audio="inline")
        audio_calls = iter([inline_audio, None])
        pipeline._listen_audio_msg = lambda publisher, task_id: next(audio_calls)
        pipeline._process_stream_response = lambda publisher, trace_manager: iter(["payload"])
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.AppGeneratorTTSPublisher",
            lambda tenant_id, voice, language: _Publisher(),
        )

        responses = list(pipeline._wrapper_process_stream_response())

        assert responses[0] == inline_audio
        assert responses[1] == "payload"
        assert isinstance(responses[-1], MessageAudioEndStreamResponse)

    def test_wrapper_process_stream_response_timeout_yields_audio_chunk(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        entity = _make_entity(ChatAppGenerateEntity, AppMode.CHAT)
        entity.app_config.app_model_config_dict = {
            "text_to_speech": {"autoPlay": "enabled", "enabled": True, "voice": "v", "language": "en"}
        }
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=entity,
            queue_manager=SimpleNamespace(),
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

        pipeline._process_stream_response = lambda publisher, trace_manager: iter([])
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        pipeline._task_state.llm_result.message.content = "raw answer"
        pipeline.queue_manager.listen = lambda: iter(
            [SimpleNamespace(event=QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL))]
        )
        pipeline._handle_stop = Mock()
        pipeline.handle_output_moderation_when_task_finished = lambda answer: "moderated answer"
        pipeline._message_cycle_manager.message_replace_to_stream_response = lambda answer: f"replace:{answer}"
        pipeline._save_message = lambda **kwargs: None
        pipeline._message_end_to_stream_response = lambda: "end"

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
            SimpleNamespace(engine=object()),
        )

        responses = list(pipeline._process_stream_response(publisher=None))

        assert responses == ["replace:moderated answer", "end"]
        pipeline._handle_stop.assert_called_once()

    def test_process_stream_response_handles_retriever_unknown_and_empty_chunk(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
        pipeline.queue_manager.listen = lambda: iter(
            [
                SimpleNamespace(event=retriever_event),
                SimpleNamespace(event=SimpleNamespace()),
                SimpleNamespace(event=QueueLLMChunkEvent(chunk=chunk)),
            ]
        )

        responses = list(pipeline._process_stream_response(publisher=None))

        assert responses == []
        assert handled["retriever"] == 1

    def test_process_stream_response_skips_when_output_moderation_directs_chunk(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
        pipeline.queue_manager.listen = lambda: iter([SimpleNamespace(event=QueueLLMChunkEvent(chunk=chunk))])

        responses = list(pipeline._process_stream_response(publisher=None))

        assert responses == []

    def test_process_stream_response_ignores_unsupported_chunk_content_types(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        chunk = SimpleNamespace(
            prompt_messages=[],
            delta=SimpleNamespace(message=SimpleNamespace(content=[object(), "ok"])),
        )
        pipeline._message_cycle_manager.get_message_event_type = lambda message_id: None
        pipeline._message_cycle_manager.message_to_stream_response = lambda **kwargs: kwargs["answer"]
        pipeline.queue_manager.listen = lambda: iter(
            [SimpleNamespace(event=QueueLLMChunkEvent.model_construct(chunk=chunk))]
        )

        responses = list(pipeline._process_stream_response(publisher=None))

        assert responses == ["ok"]

    def test_process_stream_response_reaches_post_loop_branch_with_thread_reference(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )
        pipeline._conversation_name_generate_thread = object()
        pipeline.queue_manager.listen = lambda: iter([])

        assert list(pipeline._process_stream_response(publisher=None)) == []

    def test_save_message_persists_fields_and_emits_trace(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )
        pipeline.start_at = 10.0
        pipeline._model_config = SimpleNamespace(mode="chat")
        pipeline._task_state.llm_result.prompt_messages = [AssistantPromptMessage(content="prompt")]
        pipeline._task_state.llm_result.message = AssistantPromptMessage(content="  {{name}} hello  ")
        pipeline._task_state.llm_result.usage = LLMUsage.from_metadata(
            {"prompt_tokens": 3, "completion_tokens": 5, "total_price": "1.23"}
        )

        message_obj = SimpleNamespace(id="msg")
        conversation_obj = SimpleNamespace(id="conv")
        session = Mock()
        session.scalar.side_effect = [message_obj, conversation_obj]
        trace_manager = SimpleNamespace(add_trace_task=Mock())
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
        assert trace_manager.add_trace_task.called
        assert len(sent_payloads) == 1

    def test_save_message_raises_when_message_not_found(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )
        session = Mock()
        session.scalar.return_value = None

        with pytest.raises(ValueError, match="message msg not found"):
            pipeline._save_message(session=session)

    def test_save_message_raises_when_conversation_not_found(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )
        session = Mock()
        session.scalar.side_effect = [SimpleNamespace(id="msg"), None]

        with pytest.raises(ValueError, match="Conversation conv not found"):
            pipeline._save_message(session=session)

    def test_message_end_to_stream_response_includes_usage_metadata(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
            SimpleNamespace(engine=object()),
        )

        response = pipeline._message_end_to_stream_response()

        assert response.id == "msg"
        assert response.metadata["usage"]["prompt_tokens"] == 1

    def test_record_files_returns_none_when_message_has_no_files(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
            SimpleNamespace(engine=object()),
        )

        response = pipeline._message_end_to_stream_response()

        assert response.files is None

    def test_record_files_handles_local_fallback_and_tool_url_variants(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )
        message_files = [
            SimpleNamespace(
                id="mf-local-fallback",
                message_id="msg",
                transfer_method=FileTransferMethod.LOCAL_FILE,
                url="",
                upload_file_id="upload-missing",
                type="file",
            ),
            SimpleNamespace(
                id="mf-tool-http",
                message_id="msg",
                transfer_method=FileTransferMethod.TOOL_FILE,
                url="http://cdn.example.com/file.txt?x=1",
                upload_file_id=None,
                type="file",
            ),
            SimpleNamespace(
                id="mf-tool-noext",
                message_id="msg",
                transfer_method=FileTransferMethod.TOOL_FILE,
                url="tool/path/toolid",
                upload_file_id=None,
                type="file",
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
            SimpleNamespace(engine=object()),
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
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=True,
        )

        response = pipeline._agent_message_to_stream_response(answer="hello", message_id="msg")

        assert response.id == "msg"
        assert response.answer == "hello"

    def test_agent_thought_to_stream_response_returns_none_when_not_found(self, monkeypatch: pytest.MonkeyPatch):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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
            SimpleNamespace(engine=object()),
        )

        response = pipeline._agent_thought_to_stream_response(QueueAgentThoughtEvent(agent_thought_id="missing"))

        assert response is None

    def test_handle_output_moderation_chunk_appends_token_when_not_directing(self):
        conversation = SimpleNamespace(id="conv", mode=AppMode.CHAT)
        message = SimpleNamespace(id="msg", created_at=datetime.now(UTC))
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=_make_entity(ChatAppGenerateEntity, AppMode.CHAT),
            queue_manager=SimpleNamespace(),
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

        pipeline.output_moderation_handler = _Moderation()

        result = pipeline._handle_output_moderation_chunk("next-token")

        assert result is False
        assert appended_tokens == ["next-token"]
