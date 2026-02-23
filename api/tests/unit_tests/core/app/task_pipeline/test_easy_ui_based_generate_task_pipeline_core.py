from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

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
    QueueStopEvent,
)
from core.app.entities.task_entities import MessageEndStreamResponse, PingStreamResponse
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import AssistantPromptMessage, TextPromptMessageContent
from core.workflow.file.enums import FileTransferMethod
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

    def test_process_stream_response_handles_chunks_and_end(self, monkeypatch):
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

    def test_handle_stop_updates_usage(self, monkeypatch):
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

    def test_record_files_builds_file_payloads(self, monkeypatch):
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
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.file_helpers.get_signed_file_url",
            lambda **kwargs: "signed-url",
        )
        monkeypatch.setattr(
            "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.sign_tool_file",
            lambda **kwargs: "signed-tool",
        )

        files = pipeline._record_files()

        assert files
        assert len(files) == 3

    def test_process_stream_response_handles_annotation_and_error(self, monkeypatch):
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

    def test_agent_thought_to_stream_response_returns_payload(self, monkeypatch):
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

            def query(self, *args, **kwargs):
                return self

            def where(self, *args, **kwargs):
                return self

            def first(self):
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
