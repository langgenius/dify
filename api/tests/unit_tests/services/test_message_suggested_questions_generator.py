"""Suggested-question model selection, invocation parameters and failure fallbacks."""

from collections.abc import Sequence
from typing import NoReturn
from unittest.mock import Mock, patch

import pytest

from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.base import _get_plugin_daemon_request_timeout
from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType, ParameterRule, ParameterType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_service import SuggestedQuestionsContext, SuggestedQuestionsEndUser
from tests.unit_tests.core.model_fixtures import make_model_config, make_model_instance


def _llm_result(content: str) -> LLMResult:
    return LLMResult(
        model="test-model",
        message=AssistantPromptMessage(content=content),
        usage=LLMUsage.empty_usage(),
    )


def _generate_questions(
    tenant_id: str,
    histories: str,
    *,
    instruction_prompt: str | None = None,
    model_config: object | None = None,
) -> Sequence[str]:
    prepared_model = SuggestedQuestionsGenerator._prepare_model(tenant_id, model_config=model_config)
    if prepared_model is None:
        return []
    return SuggestedQuestionsGenerator._invoke(prepared_model, histories, instruction_prompt=instruction_prompt)


@pytest.fixture
def model_schema() -> AIModelEntity:
    return make_model_config(provider="openai", model="gpt-4o", mode="chat").model_schema


@pytest.fixture
def model_manager(monkeypatch: pytest.MonkeyPatch) -> ModelManager:
    manager = create_plugin_model_manager(tenant_id="tenant_id")
    monkeypatch.setattr(ModelManager, "for_tenant", lambda **_kwargs: manager)
    return manager


@pytest.fixture
def model_instance(
    monkeypatch: pytest.MonkeyPatch, model_schema: AIModelEntity, model_manager: ModelManager
) -> ModelInstance:
    instance = make_model_instance(provider="openai", model="gpt-4o")
    monkeypatch.setattr(instance.model_type_instance.model_runtime, "get_model_schema", lambda **_kwargs: model_schema)
    monkeypatch.setattr(model_manager, "get_model_instance", lambda **_kwargs: instance)
    monkeypatch.setattr(model_manager, "get_default_model_instance", lambda **_kwargs: instance)
    return instance


@pytest.fixture
def llm_invocation(monkeypatch: pytest.MonkeyPatch, model_instance: ModelInstance) -> Mock:
    invocation = Mock(return_value=_llm_result('["Question 1?"]'))
    monkeypatch.setattr(model_instance.model_type_instance.model_runtime, "invoke_llm", invocation)
    return invocation


class TestSuggestedQuestionsGenerator:
    def test_generate_suggested_questions_after_answer_success(self, llm_invocation: Mock) -> None:
        llm_invocation.return_value = _llm_result('["Question 1?", "Question 2?"]')

        questions = _generate_questions("tenant_id", "histories")
        assert len(questions) == 2
        assert questions[0] == "Question 1?"
        assert llm_invocation.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
        }

    def test_generate_suggested_questions_after_answer_uses_lowest_reasoning_effort(
        self, llm_invocation: Mock, model_schema: AIModelEntity
    ) -> None:
        model_schema.parameter_rules = [
            ParameterRule(
                name="reasoning_effort",
                label=I18nObject(en_US="Reasoning effort"),
                type=ParameterType.STRING,
                options=["minimal", "low", "medium", "high"],
            )
        ]

        questions = _generate_questions("tenant_id", "histories")

        assert questions == ["Question 1?"]
        assert llm_invocation.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
            "reasoning_effort": "minimal",
        }

    def test_generate_suggested_questions_after_answer_uses_defaults_when_schema_lookup_fails(
        self, llm_invocation: Mock, model_instance: ModelInstance
    ) -> None:
        with patch.object(
            model_instance.model_type_instance.model_runtime,
            "get_model_schema",
            side_effect=ValueError("schema unavailable"),
        ):
            questions = _generate_questions("tenant_id", "histories")

        assert questions == ["Question 1?"]
        assert llm_invocation.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
        }

    @pytest.mark.parametrize(
        ("parameter_type", "options", "expected_value"),
        [
            (ParameterType.BOOLEAN, [], False),
            (ParameterType.STRING, ["enabled", "disabled"], "disabled"),
        ],
    )
    def test_generate_suggested_questions_after_answer_disables_thinking(
        self,
        llm_invocation: Mock,
        model_schema: AIModelEntity,
        parameter_type: ParameterType,
        options: list[str],
        expected_value: bool | str,
    ) -> None:
        model_schema.parameter_rules = [
            ParameterRule(name="thinking", label=I18nObject(en_US="Thinking"), type=parameter_type, options=options),
            ParameterRule(
                name="reasoning_effort",
                label=I18nObject(en_US="Reasoning effort"),
                type=ParameterType.STRING,
                options=["low", "high"],
            ),
        ]

        questions = _generate_questions("tenant_id", "histories")

        assert questions == ["Question 1?"]
        assert llm_invocation.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
            "thinking": expected_value,
        }

    def test_generate_suggested_questions_after_answer_auth_error(
        self, model_manager: ModelManager, llm_invocation: Mock
    ) -> None:
        with patch.object(
            model_manager, "get_default_model_instance", side_effect=InvokeAuthorizationError("Auth failed")
        ):
            questions = _generate_questions("tenant_id", "histories")
            assert questions == []
        llm_invocation.assert_not_called()

    def test_generate_suggested_questions_after_answer_model_resolution_error(
        self, model_manager: ModelManager, llm_invocation: Mock
    ) -> None:
        with patch.object(
            model_manager, "get_default_model_instance", side_effect=ValueError("unsupported default model")
        ):
            questions = _generate_questions("tenant_id", "histories")

        assert questions == []
        llm_invocation.assert_not_called()

    def test_generate_suggested_questions_after_answer_invoke_error(self, llm_invocation: Mock) -> None:
        llm_invocation.side_effect = InvokeError("Invoke failed")
        questions = _generate_questions("tenant_id", "histories")
        assert questions == []
        llm_invocation.assert_called_once()

    def test_generate_suggested_questions_after_answer_exception(self, llm_invocation: Mock) -> None:
        llm_invocation.side_effect = Exception("Random error")
        questions = _generate_questions("tenant_id", "histories")
        assert questions == []
        llm_invocation.assert_called_once()

    def test_generate_suggested_questions_after_answer_with_custom_model_and_prompt(
        self, model_manager: ModelManager, model_instance: ModelInstance, llm_invocation: Mock
    ) -> None:
        with patch.object(model_manager, "get_model_instance", return_value=model_instance) as model_lookup:
            questions = _generate_questions(
                "tenant_id",
                "histories",
                instruction_prompt="custom prompt",
                model_config={
                    "provider": "openai",
                    "name": "gpt-4o",
                    "completion_params": {"temperature": 0.2},
                },
            )

        assert questions == ["Question 1?"]
        model_lookup.assert_called_once_with(
            tenant_id="tenant_id",
            model_type=ModelType.LLM,
            provider="openai",
            model="gpt-4o",
        )

        invoke_kwargs = llm_invocation.call_args.kwargs
        assert invoke_kwargs["model_parameters"] == {"temperature": 0.2}
        assert invoke_kwargs["stop"] is None
        assert "custom prompt" in invoke_kwargs["prompt_messages"][0].content

    def test_generate_suggested_questions_after_answer_with_custom_model_without_completion_params(
        self, llm_invocation: Mock
    ) -> None:
        questions = _generate_questions(
            "tenant_id",
            "histories",
            model_config={"provider": "openai", "name": "gpt-4o"},
        )

        assert questions == ["Question 1?"]
        invoke_kwargs = llm_invocation.call_args.kwargs
        assert invoke_kwargs["model_parameters"] == {}
        assert invoke_kwargs["stop"] is None

    def test_generate_suggested_questions_after_answer_fallback_to_default_model(
        self, model_manager: ModelManager, model_instance: ModelInstance, llm_invocation: Mock
    ) -> None:
        with (
            patch.object(model_manager, "get_model_instance", side_effect=ValueError("invalid configured model")),
            patch.object(model_manager, "get_default_model_instance", return_value=model_instance) as default_lookup,
        ):
            questions = _generate_questions(
                "tenant_id",
                "histories",
                model_config={
                    "provider": "openai",
                    "name": "not-found-model",
                    "completion_params": {"temperature": 0.2},
                },
            )

        assert questions == ["Question 1?"]
        default_lookup.assert_called_once_with(
            tenant_id="tenant_id",
            model_type=ModelType.LLM,
        )
        assert llm_invocation.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
        }
        assert llm_invocation.call_args.kwargs["stop"] is None

    def test_generate_suggested_questions_after_answer_drops_non_positive_max_tokens(
        self, llm_invocation: Mock
    ) -> None:
        questions = _generate_questions(
            "tenant_id",
            "histories",
            model_config={
                "provider": "openai",
                "name": "gpt-4o",
                "completion_params": {
                    "temperature": 0.2,
                    "max_tokens": 0,
                    "stop": ["END"],
                },
            },
        )

        assert questions == ["Question 1?"]
        invoke_kwargs = llm_invocation.call_args.kwargs
        assert invoke_kwargs["model_parameters"] == {"temperature": 0.2}
        assert invoke_kwargs["stop"] == ["END"]

    @pytest.mark.parametrize("use_configured_model", [False, True])
    def test_prepared_suggested_questions_defer_provider_calls_without_resolving_again(
        self, monkeypatch: pytest.MonkeyPatch, use_configured_model: bool
    ) -> None:
        model_instance = make_model_instance(provider="openai", model="custom-model")
        schema = make_model_config(provider="openai", model="custom-model", mode="chat").model_schema
        get_schema = Mock(return_value=schema)
        invocation = Mock()
        runtime = model_instance.model_type_instance.model_runtime
        monkeypatch.setattr(runtime, "get_model_schema", get_schema)
        monkeypatch.setattr(runtime, "invoke_llm", invocation)
        manager = create_plugin_model_manager(tenant_id="tenant_id")
        monkeypatch.setattr(manager, "get_model_instance", Mock(return_value=model_instance))
        monkeypatch.setattr(manager, "get_default_model_instance", Mock(return_value=model_instance))
        resolve_manager = Mock(return_value=manager)
        monkeypatch.setattr(ModelManager, "for_tenant", resolve_manager)
        original_metadata = get_credit_usage_metadata()
        original_timeout = _get_plugin_daemon_request_timeout()

        def invoke(**_kwargs: object) -> LLMResult:
            metadata = get_credit_usage_metadata()
            assert metadata is not None
            assert metadata["created_by"] == CreditUsageCreatedBy.SUGGESTED_QUESTIONS
            assert _kwargs["request_metadata"] == metadata
            timeout = _get_plugin_daemon_request_timeout()
            assert timeout is not None
            assert timeout.read == 30.0
            return _llm_result('["Next question?"]')

        invocation.side_effect = invoke
        model_config = (
            {
                "provider": "openai",
                "name": "custom-model",
                "completion_params": {"temperature": 0.2, "stop": ["END"], "max_tokens": 0},
            }
            if use_configured_model
            else None
        )
        prepared_model = SuggestedQuestionsGenerator._prepare_model("tenant_id", model_config=model_config)

        assert prepared_model is not None
        get_schema.assert_not_called()
        invocation.assert_not_called()
        resolve_manager.side_effect = AssertionError("Model lookup must finish in the preparation phase")

        result = SuggestedQuestionsGenerator._invoke(
            prepared_model, "Human: hello\nAssistant: world", instruction_prompt="Ask a follow-up"
        )

        assert result == ["Next question?"]
        parameters = invocation.call_args.kwargs
        assert parameters["model_parameters"] == (
            {"temperature": 0.2} if use_configured_model else {"max_tokens": 256, "temperature": 0.0}
        )
        assert parameters["stop"] == (["END"] if use_configured_model else None)
        assert parameters["stream"] is False
        assert "Human: hello\nAssistant: world" in parameters["prompt_messages"][0].content
        assert "Ask a follow-up" in parameters["prompt_messages"][0].content
        assert get_credit_usage_metadata() == original_metadata
        assert _get_plugin_daemon_request_timeout() == original_timeout


def test_prepare_without_history_model_yields_none_without_tracing(
    monkeypatch: pytest.MonkeyPatch, model_manager: ModelManager
) -> None:
    context = SuggestedQuestionsContext(
        app_id="app-id",
        tenant_id="tenant-id",
        app_mode="chat",
        message_id="message-id",
        conversation_id="conversation-id",
        actor=SuggestedQuestionsEndUser(end_user_id="user-id", invoke_from="service-api"),
        config={"enabled": True},
    )

    def unexpected_trace(*, app_id: str) -> NoReturn:
        raise AssertionError(f"No trace manager should be created for {app_id} without a history model")

    monkeypatch.setattr("services.message_suggested_questions_generator.TraceQueueManager", unexpected_trace)
    with patch.object(model_manager, "get_default_model_instance", side_effect=ValueError("No default model")):
        with SuggestedQuestionsGenerator().prepare(
            context=context, instruction_prompt=None, model_config=None
        ) as generate:
            assert generate is None
