from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.app_config.entities import (
    AdvancedChatMessageEntity,
    AdvancedChatPromptTemplateEntity,
    AdvancedCompletionPromptTemplateEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueAgentMessageEvent, QueueLLMChunkEvent, QueueMessageEndEvent
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessageRole,
    TextPromptMessageContent,
)
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from models.model import AppMode


class _DummyParameterRule:
    def __init__(self, name: str, use_template: str | None = None) -> None:
        self.name = name
        self.use_template = use_template


class _QueueRecorder:
    def __init__(self) -> None:
        self.events: list[object] = []

    def publish(self, event, pub_from):
        _ = pub_from
        self.events.append(event)


class TestAppRunner:
    def test_recalc_llm_max_tokens_updates_parameters(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()

        model_schema = SimpleNamespace(
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 100},
            parameter_rules=[_DummyParameterRule("max_tokens")],
        )
        model_config = SimpleNamespace(
            provider_model_bundle=object(),
            model="mock",
            model_schema=model_schema,
            parameters={"max_tokens": 30},
        )

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.ModelInstance",
            lambda provider_model_bundle, model: SimpleNamespace(get_llm_num_tokens=lambda messages: 80),
        )

        runner.recalc_llm_max_tokens(model_config, prompt_messages=[AssistantPromptMessage(content="hi")])

        assert model_config.parameters["max_tokens"] == 20

    def test_recalc_llm_max_tokens_returns_minus_one_when_no_context(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()

        model_schema = SimpleNamespace(
            model_properties={},
            parameter_rules=[_DummyParameterRule("max_tokens")],
        )
        model_config = SimpleNamespace(
            provider_model_bundle=object(),
            model="mock",
            model_schema=model_schema,
            parameters={"max_tokens": 30},
        )

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.ModelInstance",
            lambda provider_model_bundle, model: SimpleNamespace(get_llm_num_tokens=lambda messages: 10),
        )

        assert runner.recalc_llm_max_tokens(model_config, prompt_messages=[]) == -1

    def test_direct_output_streaming_publishes_chunks_and_end(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        queue = _QueueRecorder()
        app_generate_entity = SimpleNamespace(model_conf=SimpleNamespace(model="mock"), stream=True)

        monkeypatch.setattr("core.app.apps.base_app_runner.time.sleep", lambda _: None)

        runner.direct_output(
            queue_manager=queue,
            app_generate_entity=app_generate_entity,
            prompt_messages=[],
            text="hi",
            stream=True,
        )

        assert any(isinstance(event, QueueLLMChunkEvent) for event in queue.events)
        assert isinstance(queue.events[-1], QueueMessageEndEvent)

    def test_handle_invoke_result_direct_publishes_end_event(self):
        runner = AppRunner()
        queue = _QueueRecorder()
        llm_result = LLMResult(
            model="mock",
            prompt_messages=[],
            message=AssistantPromptMessage(content="done"),
            usage=LLMUsage.empty_usage(),
        )

        runner._handle_invoke_result(
            invoke_result=llm_result,
            queue_manager=queue,
            stream=False,
        )

        assert isinstance(queue.events[-1], QueueMessageEndEvent)

    def test_handle_invoke_result_invalid_type_raises(self):
        runner = AppRunner()
        queue = _QueueRecorder()

        with pytest.raises(NotImplementedError):
            runner._handle_invoke_result(
                invoke_result=["unexpected"],
                queue_manager=queue,
                stream=True,
            )

    def test_organize_prompt_messages_simple_template(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        model_config = SimpleNamespace(mode="chat", stop=["STOP"])
        prompt_template_entity = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="hello",
        )

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.SimplePromptTransform.get_prompt",
            lambda self, **kwargs: (["simple-message"], ["simple-stop"]),
        )

        prompt_messages, stop = runner.organize_prompt_messages(
            app_record=SimpleNamespace(mode=AppMode.CHAT.value),
            model_config=model_config,
            prompt_template_entity=prompt_template_entity,
            inputs={},
            files=[],
            query="q",
        )

        assert prompt_messages == ["simple-message"]
        assert stop == ["simple-stop"]

    def test_organize_prompt_messages_advanced_completion_template(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        model_config = SimpleNamespace(mode="completion", stop=["<END>"])
        captured: dict[str, object] = {}
        prompt_template_entity = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
            advanced_completion_prompt_template=AdvancedCompletionPromptTemplateEntity(
                prompt="answer",
                role_prefix=AdvancedCompletionPromptTemplateEntity.RolePrefixEntity(user="U", assistant="A"),
            ),
        )

        def _fake_advanced_prompt(self, **kwargs):
            captured.update(kwargs)
            return ["advanced-completion-message"]

        monkeypatch.setattr("core.app.apps.base_app_runner.AdvancedPromptTransform.get_prompt", _fake_advanced_prompt)

        prompt_messages, stop = runner.organize_prompt_messages(
            app_record=SimpleNamespace(mode=AppMode.CHAT.value),
            model_config=model_config,
            prompt_template_entity=prompt_template_entity,
            inputs={},
            files=[],
            query="q",
        )

        assert prompt_messages == ["advanced-completion-message"]
        assert stop == ["<END>"]
        memory_config = captured["memory_config"]
        assert memory_config.role_prefix.user == "U"
        assert memory_config.role_prefix.assistant == "A"

    def test_organize_prompt_messages_advanced_chat_template(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        model_config = SimpleNamespace(mode="chat", stop=["<END>"])
        captured: dict[str, object] = {}
        prompt_template_entity = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
            advanced_chat_prompt_template=AdvancedChatPromptTemplateEntity(
                messages=[
                    AdvancedChatMessageEntity(text="hello", role=PromptMessageRole.USER),
                    AdvancedChatMessageEntity(text="world", role=PromptMessageRole.ASSISTANT),
                ]
            ),
        )

        def _fake_advanced_prompt(self, **kwargs):
            captured.update(kwargs)
            return ["advanced-chat-message"]

        monkeypatch.setattr("core.app.apps.base_app_runner.AdvancedPromptTransform.get_prompt", _fake_advanced_prompt)

        prompt_messages, stop = runner.organize_prompt_messages(
            app_record=SimpleNamespace(mode=AppMode.CHAT.value),
            model_config=model_config,
            prompt_template_entity=prompt_template_entity,
            inputs={},
            files=[],
            query="q",
        )

        assert prompt_messages == ["advanced-chat-message"]
        assert stop == ["<END>"]
        assert len(captured["prompt_template"]) == 2

    def test_organize_prompt_messages_advanced_missing_templates_raise(self):
        runner = AppRunner()

        with pytest.raises(InvokeBadRequestError, match="Advanced completion prompt template is required"):
            runner.organize_prompt_messages(
                app_record=SimpleNamespace(mode=AppMode.CHAT.value),
                model_config=SimpleNamespace(mode="completion", stop=[]),
                prompt_template_entity=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.ADVANCED),
                inputs={},
                files=[],
            )

        with pytest.raises(InvokeBadRequestError, match="Advanced chat prompt template is required"):
            runner.organize_prompt_messages(
                app_record=SimpleNamespace(mode=AppMode.CHAT.value),
                model_config=SimpleNamespace(mode="chat", stop=[]),
                prompt_template_entity=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.ADVANCED),
                inputs={},
                files=[],
            )

    def test_handle_invoke_result_stream_routes_chunks_and_builds_message(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        queue = _QueueRecorder()
        warning_logger = MagicMock()
        monkeypatch.setattr("core.app.apps.base_app_runner._logger.warning", warning_logger)

        image_content = ImagePromptMessageContent(
            url="https://example.com/image.png", format="png", mime_type="image/png"
        )

        def _stream():
            yield LLMResultChunk(
                model="stream-model",
                prompt_messages=[AssistantPromptMessage(content="prompt")],
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage.model_construct(
                        content=[
                            "a",
                            TextPromptMessageContent(data="b"),
                            SimpleNamespace(data="c"),
                            image_content,
                        ]
                    ),
                ),
            )

        runner._handle_invoke_result(
            invoke_result=_stream(),
            queue_manager=queue,
            stream=True,
            agent=False,
        )

        assert isinstance(queue.events[0], QueueLLMChunkEvent)
        assert isinstance(queue.events[-1], QueueMessageEndEvent)
        assert queue.events[-1].llm_result.message.content == "abc"
        warning_logger.assert_called_once()

    def test_handle_invoke_result_stream_agent_mode_handles_multimodal_errors(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        queue = _QueueRecorder()
        exception_logger = MagicMock()
        monkeypatch.setattr("core.app.apps.base_app_runner._logger.exception", exception_logger)

        monkeypatch.setattr(
            runner,
            "_handle_multimodal_image_content",
            MagicMock(side_effect=RuntimeError("failed to save image")),
        )
        usage = LLMUsage.empty_usage()

        def _stream():
            yield LLMResultChunk(
                model="agent-model",
                prompt_messages=[AssistantPromptMessage(content="prompt")],
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(
                        content=[
                            ImagePromptMessageContent(
                                url="https://example.com/image.png",
                                format="png",
                                mime_type="image/png",
                            ),
                            TextPromptMessageContent(data="done"),
                        ]
                    ),
                    usage=usage,
                ),
            )

        runner._handle_invoke_result_stream(
            invoke_result=_stream(),
            queue_manager=queue,
            agent=True,
            message_id="message-id",
            user_id="user-id",
            tenant_id="tenant-id",
        )

        assert isinstance(queue.events[0], QueueAgentMessageEvent)
        assert isinstance(queue.events[-1], QueueMessageEndEvent)
        assert queue.events[-1].llm_result.usage == usage
        exception_logger.assert_called_once()

    def test_handle_multimodal_image_content_fallback_return_branch(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()

        class _ToggleBool:
            def __init__(self, values: list[bool]):
                self._values = values
                self._index = 0

            def __bool__(self):
                value = self._values[min(self._index, len(self._values) - 1)]
                self._index += 1
                return value

        content = SimpleNamespace(
            url=_ToggleBool([False, False]),
            base64_data=_ToggleBool([True, False]),
            mime_type="image/png",
        )

        db_session = SimpleNamespace(add=MagicMock(), commit=MagicMock(), refresh=MagicMock())
        monkeypatch.setattr("core.app.apps.base_app_runner.ToolFileManager", lambda: MagicMock())
        monkeypatch.setattr("core.app.apps.base_app_runner.db", SimpleNamespace(session=db_session))

        queue_manager = SimpleNamespace(invoke_from=InvokeFrom.SERVICE_API, publish=MagicMock())

        runner._handle_multimodal_image_content(
            content=content,
            message_id="message-id",
            user_id="user-id",
            tenant_id="tenant-id",
            queue_manager=queue_manager,
        )

        db_session.add.assert_not_called()
        queue_manager.publish.assert_not_called()

    def test_check_hosting_moderation_direct_output_called(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        queue = _QueueRecorder()
        app_generate_entity = SimpleNamespace(stream=False)

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.HostingModerationFeature.check",
            lambda self, application_generate_entity, prompt_messages: True,
        )
        direct_output = MagicMock()
        monkeypatch.setattr(runner, "direct_output", direct_output)

        result = runner.check_hosting_moderation(
            application_generate_entity=app_generate_entity,
            queue_manager=queue,
            prompt_messages=[],
        )

        assert result is True
        assert direct_output.called

    def test_fill_in_inputs_from_external_data_tools(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        monkeypatch.setattr(
            "core.app.apps.base_app_runner.ExternalDataFetch.fetch",
            lambda self, tenant_id, app_id, external_data_tools, inputs, query: {"foo": "bar"},
        )

        result = runner.fill_in_inputs_from_external_data_tools(
            tenant_id="tenant",
            app_id="app",
            external_data_tools=[],
            inputs={},
            query="q",
        )

        assert result == {"foo": "bar"}

    def test_moderation_for_inputs_returns_result(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        monkeypatch.setattr(
            "core.app.apps.base_app_runner.InputModeration.check",
            lambda self, app_id, tenant_id, app_config, inputs, query, message_id, trace_manager: (True, {}, ""),
        )
        app_generate_entity = SimpleNamespace(app_config=SimpleNamespace(), trace_manager=None)

        result = runner.moderation_for_inputs(
            app_id="app",
            tenant_id="tenant",
            app_generate_entity=app_generate_entity,
            inputs={},
            query="q",
            message_id="msg",
        )

        assert result == (True, {}, "")

    def test_query_app_annotations_to_reply(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        monkeypatch.setattr(
            "core.app.apps.base_app_runner.AnnotationReplyFeature.query",
            lambda self, app_record, message, query, user_id, invoke_from: "reply",
        )

        response = runner.query_app_annotations_to_reply(
            app_record=SimpleNamespace(),
            message=SimpleNamespace(),
            query="hello",
            user_id="user",
            invoke_from=InvokeFrom.WEB_APP,
        )

        assert response == "reply"
