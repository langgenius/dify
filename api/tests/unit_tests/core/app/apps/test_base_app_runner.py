from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueLLMChunkEvent, QueueMessageEndEvent
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.model_runtime.entities.model_entities import ModelPropertyKey


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
    def test_recalc_llm_max_tokens_updates_parameters(self, monkeypatch):
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

    def test_recalc_llm_max_tokens_returns_minus_one_when_no_context(self, monkeypatch):
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

    def test_direct_output_streaming_publishes_chunks_and_end(self, monkeypatch):
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

    def test_check_hosting_moderation_direct_output_called(self, monkeypatch):
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

    def test_fill_in_inputs_from_external_data_tools(self, monkeypatch):
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

    def test_moderation_for_inputs_returns_result(self, monkeypatch):
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

    def test_query_app_annotations_to_reply(self, monkeypatch):
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
