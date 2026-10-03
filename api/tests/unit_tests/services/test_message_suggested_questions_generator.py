"""Suggested-question model selection, invocation parameters and failure fallbacks."""

from collections.abc import Iterator, Sequence
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelManager
from core.plugin.impl.base import _get_plugin_daemon_request_timeout
from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType, ParameterType
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


class TestSuggestedQuestionsGenerator:
    @pytest.fixture
    def mock_model_instance(self) -> Iterator[MagicMock]:
        with patch("services.message_suggested_questions_generator.ModelManager.for_tenant") as mock_manager:
            instance = MagicMock()
            mock_manager.return_value.get_default_model_instance.return_value = instance
            mock_manager.return_value.get_model_instance.return_value = instance
            yield instance

    def test_generate_suggested_questions_after_answer_success(self, mock_model_instance: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '["Question 1?", "Question 2?"]'
        mock_model_instance.invoke_llm.return_value = mock_response

        questions = _generate_questions("tenant_id", "histories")
        assert len(questions) == 2
        assert questions[0] == "Question 1?"
        assert mock_model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
        }

    def test_generate_suggested_questions_after_answer_uses_lowest_reasoning_effort(
        self, mock_model_instance: MagicMock
    ) -> None:
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '["Question 1?"]'
        mock_model_instance.invoke_llm.return_value = mock_response
        mock_model_instance.get_model_schema.return_value.parameter_rules = [
            SimpleNamespace(
                name="reasoning_effort",
                type=ParameterType.STRING,
                options=["minimal", "low", "medium", "high"],
            )
        ]

        questions = _generate_questions("tenant_id", "histories")

        assert questions == ["Question 1?"]
        assert mock_model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
            "reasoning_effort": "minimal",
        }

    def test_generate_suggested_questions_after_answer_uses_defaults_when_schema_lookup_fails(
        self, mock_model_instance: MagicMock
    ) -> None:
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '["Question 1?"]'
        mock_model_instance.invoke_llm.return_value = mock_response
        mock_model_instance.get_model_schema.side_effect = ValueError("schema unavailable")

        questions = _generate_questions("tenant_id", "histories")

        assert questions == ["Question 1?"]
        assert mock_model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {
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
        mock_model_instance: MagicMock,
        parameter_type: ParameterType,
        options: list[str],
        expected_value: bool | str,
    ) -> None:
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '["Question 1?"]'
        mock_model_instance.invoke_llm.return_value = mock_response
        mock_model_instance.get_model_schema.return_value.parameter_rules = [
            SimpleNamespace(name="thinking", type=parameter_type, options=options),
            SimpleNamespace(name="reasoning_effort", type=ParameterType.STRING, options=["low", "high"]),
        ]

        questions = _generate_questions("tenant_id", "histories")

        assert questions == ["Question 1?"]
        assert mock_model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
            "thinking": expected_value,
        }

    def test_generate_suggested_questions_after_answer_auth_error(self) -> None:
        with patch("services.message_suggested_questions_generator.ModelManager.for_tenant") as mock_manager:
            mock_manager.return_value.get_default_model_instance.side_effect = InvokeAuthorizationError("Auth failed")
            questions = _generate_questions("tenant_id", "histories")
            assert questions == []

    def test_generate_suggested_questions_after_answer_model_resolution_error(self) -> None:
        with patch("services.message_suggested_questions_generator.ModelManager.for_tenant") as mock_manager:
            mock_manager.return_value.get_default_model_instance.side_effect = ValueError("unsupported default model")

            questions = _generate_questions("tenant_id", "histories")

        assert questions == []

    def test_generate_suggested_questions_after_answer_invoke_error(self, mock_model_instance: MagicMock) -> None:
        mock_model_instance.invoke_llm.side_effect = InvokeError("Invoke failed")
        questions = _generate_questions("tenant_id", "histories")
        assert questions == []

    def test_generate_suggested_questions_after_answer_exception(self, mock_model_instance: MagicMock) -> None:
        mock_model_instance.invoke_llm.side_effect = Exception("Random error")
        questions = _generate_questions("tenant_id", "histories")
        assert questions == []

    @patch("services.message_suggested_questions_generator.ModelManager.for_tenant")
    def test_generate_suggested_questions_after_answer_with_custom_model_and_prompt(
        self, mock_for_tenant: MagicMock
    ) -> None:
        custom_model_instance = MagicMock()
        custom_response = MagicMock()
        custom_response.message.get_text_content.return_value = '["Question 1?"]'
        custom_model_instance.invoke_llm.return_value = custom_response

        mock_for_tenant.return_value.get_model_instance.return_value = custom_model_instance

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
        mock_for_tenant.return_value.get_model_instance.assert_called_once_with(
            tenant_id="tenant_id",
            model_type=ModelType.LLM,
            provider="openai",
            model="gpt-4o",
        )

        invoke_kwargs = custom_model_instance.invoke_llm.call_args.kwargs
        assert invoke_kwargs["model_parameters"] == {"temperature": 0.2}
        assert invoke_kwargs["stop"] == []
        assert "custom prompt" in invoke_kwargs["prompt_messages"][0].content

    @patch("services.message_suggested_questions_generator.ModelManager.for_tenant")
    def test_generate_suggested_questions_after_answer_with_custom_model_without_completion_params(
        self, mock_for_tenant: MagicMock
    ) -> None:
        custom_model_instance = MagicMock()
        custom_response = MagicMock()
        custom_response.message.get_text_content.return_value = '["Question 1?"]'
        custom_model_instance.invoke_llm.return_value = custom_response
        mock_for_tenant.return_value.get_model_instance.return_value = custom_model_instance

        questions = _generate_questions(
            "tenant_id",
            "histories",
            model_config={"provider": "openai", "name": "gpt-4o"},
        )

        assert questions == ["Question 1?"]
        invoke_kwargs = custom_model_instance.invoke_llm.call_args.kwargs
        assert invoke_kwargs["model_parameters"] == {}
        assert invoke_kwargs["stop"] == []

    @patch("services.message_suggested_questions_generator.ModelManager.for_tenant")
    def test_generate_suggested_questions_after_answer_fallback_to_default_model(
        self, mock_for_tenant: MagicMock
    ) -> None:
        default_model_instance = MagicMock()
        default_response = MagicMock()
        default_response.message.get_text_content.return_value = '["Question 1?"]'
        default_model_instance.invoke_llm.return_value = default_response

        mock_for_tenant.return_value.get_model_instance.side_effect = ValueError("invalid configured model")
        mock_for_tenant.return_value.get_default_model_instance.return_value = default_model_instance

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
        mock_for_tenant.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant_id",
            model_type=ModelType.LLM,
        )
        assert default_model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {
            "max_tokens": 256,
            "temperature": 0.0,
        }
        assert default_model_instance.invoke_llm.call_args.kwargs["stop"] == []

    @patch("services.message_suggested_questions_generator.ModelManager.for_tenant")
    def test_generate_suggested_questions_after_answer_drops_non_positive_max_tokens(
        self, mock_for_tenant: MagicMock
    ) -> None:
        custom_model_instance = MagicMock()
        custom_response = MagicMock()
        custom_response.message.get_text_content.return_value = '["Question 1?"]'
        custom_model_instance.invoke_llm.return_value = custom_response
        mock_for_tenant.return_value.get_model_instance.return_value = custom_model_instance

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
        invoke_kwargs = custom_model_instance.invoke_llm.call_args.kwargs
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
        monkeypatch.setattr(model_instance, "get_model_schema", get_schema)
        monkeypatch.setattr(model_instance, "invoke_llm", invocation)
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
        assert parameters["stop"] == (["END"] if use_configured_model else [])
        assert parameters["stream"] is False
        assert "Human: hello\nAssistant: world" in parameters["prompt_messages"][0].content
        assert "Ask a follow-up" in parameters["prompt_messages"][0].content
        assert get_credit_usage_metadata() == original_metadata
        assert _get_plugin_daemon_request_timeout() == original_timeout


def test_prepare_without_history_model_yields_none_without_tracing() -> None:
    context = SuggestedQuestionsContext(
        app_id="app-id",
        tenant_id="tenant-id",
        app_mode="chat",
        message_id="message-id",
        conversation_id="conversation-id",
        actor=SuggestedQuestionsEndUser(end_user_id="user-id", invoke_from="service-api"),
        config={"enabled": True},
    )
    with (
        patch("services.message_suggested_questions_generator.ModelManager.for_tenant") as manager,
        patch("services.message_suggested_questions_generator.TraceQueueManager") as traces,
    ):
        manager.return_value.get_default_model_instance.side_effect = ValueError("No default model")
        with SuggestedQuestionsGenerator().prepare(
            context=context, instruction_prompt=None, model_config=None
        ) as generate:
            assert generate is None

    traces.assert_not_called()
