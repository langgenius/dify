"""Unit tests for ModelRuntimeOutputCheckInvoker (Stage 4 §6).

Wraps :class:`ModelManager.invoke_llm` (``stream=False``); every provider
exception is normalized to :class:`OutputCheckModelInvocationError` so the
executor has a single error surface to handle.
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from core.workflow.nodes.agent_v2.output_check_executor import (
    FileOutputCheckUsage,
    OutputCheckModelInvocationError,
)
from core.workflow.nodes.agent_v2.output_check_model_invoker import (
    ModelRuntimeOutputCheckInvoker,
)
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import ModelType


def _llm_usage(*, prompt: int = 10, completion: int = 5, latency: float = 0.5) -> LLMUsage:
    usage = LLMUsage.empty_usage()
    usage.prompt_tokens = prompt
    usage.completion_tokens = completion
    usage.total_tokens = prompt + completion
    usage.total_price = Decimal("0.002")
    usage.currency = "USD"
    usage.latency = latency
    return usage


def _llm_result(*, content: str = "VERDICT: PASS\nREASON: ok") -> LLMResult:
    return LLMResult(
        id=None,
        model="gpt-4",
        prompt_messages=[],
        message=AssistantPromptMessage(content=content),
        usage=_llm_usage(),
    )


def _make_manager_returning(result: LLMResult) -> MagicMock:
    instance = MagicMock()
    instance.invoke_llm.return_value = result
    manager = MagicMock()
    manager.get_model_instance.return_value = instance
    return manager


def test_invoke_happy_path_returns_text_and_usage():
    manager = _make_manager_returning(_llm_result(content="VERDICT: PASS\nREASON: looks good"))
    invoker = ModelRuntimeOutputCheckInvoker(model_manager_factory=lambda _: manager)

    response = invoker.invoke(
        tenant_id="tenant-1",
        model_provider="openai",
        model_name="gpt-4",
        prompt="hello",
        model_settings={"temperature": 0.0},
    )

    assert response.text == "VERDICT: PASS\nREASON: looks good"
    assert isinstance(response.usage, FileOutputCheckUsage)
    assert response.usage.prompt_tokens == 10
    assert response.usage.completion_tokens == 5
    assert response.usage.total_tokens == 15
    assert response.usage.latency_ms == 500  # 0.5s → 500ms


def test_invoke_passes_args_to_model_manager_correctly():
    manager = _make_manager_returning(_llm_result())
    invoker = ModelRuntimeOutputCheckInvoker(model_manager_factory=lambda _: manager)

    invoker.invoke(
        tenant_id="tenant-1",
        model_provider="anthropic",
        model_name="claude-sonnet",
        prompt="check this",
        model_settings={"max_tokens": 100},
    )

    manager.get_model_instance.assert_called_once_with(
        tenant_id="tenant-1",
        provider="anthropic",
        model_type=ModelType.LLM,
        model="claude-sonnet",
    )
    invoke_call = manager.get_model_instance.return_value.invoke_llm
    args, kwargs = invoke_call.call_args
    assert kwargs["stream"] is False
    assert kwargs["model_parameters"] == {"max_tokens": 100}
    # Prompt message is a single UserPromptMessage with our prompt text.
    msgs = kwargs["prompt_messages"]
    assert len(msgs) == 1
    assert isinstance(msgs[0], UserPromptMessage)
    assert msgs[0].content == "check this"


def test_invoke_with_no_settings_uses_empty_dict():
    manager = _make_manager_returning(_llm_result())
    invoker = ModelRuntimeOutputCheckInvoker(model_manager_factory=lambda _: manager)

    invoker.invoke(
        tenant_id="t",
        model_provider="openai",
        model_name="gpt-4",
        prompt="x",
    )

    kwargs = manager.get_model_instance.return_value.invoke_llm.call_args.kwargs
    assert kwargs["model_parameters"] == {}


def test_provider_error_normalized_to_output_check_model_invocation_error():
    manager = MagicMock()
    manager.get_model_instance.side_effect = RuntimeError("provider exploded")
    invoker = ModelRuntimeOutputCheckInvoker(model_manager_factory=lambda _: manager)

    with pytest.raises(OutputCheckModelInvocationError, match="provider exploded") as exc_info:
        invoker.invoke(
            tenant_id="t",
            model_provider="openai",
            model_name="gpt-4",
            prompt="x",
        )
    # Original exception is chained so logs preserve the root cause.
    assert exc_info.value.__cause__ is not None


def test_non_llm_result_normalized_to_invocation_error():
    """Defensive: a provider returning a Generator while we requested
    ``stream=False`` should not produce a cryptic AttributeError later."""
    instance = MagicMock()
    instance.invoke_llm.return_value = iter(["chunk"])  # generator-shaped, not LLMResult
    manager = MagicMock()
    manager.get_model_instance.return_value = instance
    invoker = ModelRuntimeOutputCheckInvoker(model_manager_factory=lambda _: manager)

    with pytest.raises(OutputCheckModelInvocationError, match="LLMResult"):
        invoker.invoke(
            tenant_id="t",
            model_provider="openai",
            model_name="gpt-4",
            prompt="x",
        )


def test_assistant_content_list_is_flattened_to_string():
    """Multimodal content lists are flattened to one string via ``data``/``text``
    attributes; defensive in case a provider returns content parts.

    Constructed via ``model_construct`` to bypass Pydantic's strict content
    validator — we want to verify the invoker's tolerance, not whatever
    AssistantPromptMessage's accepted-shape happens to be today.
    """

    class _TextPart:
        def __init__(self, text: str) -> None:
            self.text = text

    msg = AssistantPromptMessage.model_construct(content=[_TextPart("VERDICT: PASS"), _TextPart("REASON: ok")])
    result = _llm_result()
    result.message = msg
    manager = _make_manager_returning(result)
    invoker = ModelRuntimeOutputCheckInvoker(model_manager_factory=lambda _: manager)

    response = invoker.invoke(
        tenant_id="t",
        model_provider="openai",
        model_name="gpt-4",
        prompt="x",
    )
    assert "VERDICT: PASS" in response.text
    assert "REASON: ok" in response.text
