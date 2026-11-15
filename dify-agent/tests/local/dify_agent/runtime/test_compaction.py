import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.test import TestModel
from pydantic_ai_harness.compaction import ClearToolResults, SummarizingCompaction, TieredCompaction

from dify_agent.runtime.compaction import build_compaction_capability


def test_build_compaction_capability_uses_effective_input_budget_and_standard_tiers() -> None:
    capability = build_compaction_capability(
        context_window_tokens=10_000,
        model_settings={"max_tokens": 3_000},
    )

    assert isinstance(capability, TieredCompaction)
    assert capability.target_tokens == 7_000
    assert len(capability.tiers) == 2
    assert isinstance(capability.tiers[0], ClearToolResults)
    assert capability.tiers[0].keep_pairs == 3
    assert capability.tiers[0].clear_tool_inputs is False
    assert isinstance(capability.tiers[1], SummarizingCompaction)
    assert capability.tiers[1].model is None
    assert capability.tiers[1].keep_messages == 20
    assert capability.tiers[1].preserve_first_user_message is True
    assert capability.tiers[1].incremental is True


def test_build_compaction_capability_uses_default_budget_and_handles_unknown_window() -> None:
    capability = build_compaction_capability(context_window_tokens=10_001, model_settings=None)

    assert isinstance(capability, TieredCompaction)
    assert capability.target_tokens == 8_000
    assert build_compaction_capability(context_window_tokens=None, model_settings=None) is None


@pytest.mark.parametrize(
    "max_tokens",
    [
        pytest.param(1_000, id="default-budget-wins"),
        pytest.param(0, id="zero-is-ignored"),
        pytest.param(-1, id="negative-is-ignored"),
    ],
)
def test_build_compaction_capability_uses_default_budget_when_output_reservation_is_smaller(
    max_tokens: int,
) -> None:
    capability = build_compaction_capability(
        context_window_tokens=10_000,
        model_settings={"max_tokens": max_tokens},
    )

    assert isinstance(capability, TieredCompaction)
    assert capability.target_tokens == 8_000


def test_build_compaction_capability_rejects_output_budget_that_consumes_window() -> None:
    with pytest.raises(ValueError, match="Model max_tokens must leave a positive input context budget"):
        _ = build_compaction_capability(
            context_window_tokens=1_000,
            model_settings={"max_tokens": 1_000},
        )


def test_compaction_clears_only_tool_results_older_than_the_last_three_pairs() -> None:
    history: list[ModelRequest | ModelResponse] = []
    for index in range(4):
        tool_call_id = f"call-{index}"
        history.extend(
            [
                ModelResponse(parts=[ToolCallPart("lookup", {"query": index}, tool_call_id)]),
                ModelRequest(parts=[ToolReturnPart("lookup", "x" * 4_000, tool_call_id)]),
            ]
        )

    capability = build_compaction_capability(context_window_tokens=4_100, model_settings=None)
    assert capability is not None
    agent = Agent[None, str](TestModel(call_tools=[]), deps_type=type(None))
    result = agent.run_sync("next", message_history=history, capabilities=[capability])

    tool_returns = [
        part
        for message in result.all_messages()
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]
    assert [part.content for part in tool_returns] == ["[tool result cleared]", *("x" * 4_000 for _ in range(3))]


def test_compaction_summary_is_present_in_full_run_history() -> None:
    history: list[ModelRequest | ModelResponse] = []
    for index in range(30):
        history.extend(
            [
                ModelRequest(parts=[UserPromptPart(f"user-{index}-" + "u" * 120)]),
                ModelResponse(parts=[TextPart(f"assistant-{index}-" + "a" * 120)], model_name="test"),
            ]
        )

    capability = build_compaction_capability(context_window_tokens=1_000, model_settings=None)
    assert capability is not None
    agent = Agent[None, str](
        TestModel(call_tools=[], custom_output_text="summary body"),
        deps_type=type(None),
    )
    result = agent.run_sync(
        "next",
        message_history=history,
        capabilities=[capability],
    )

    messages = result.all_messages()
    assert len(messages) < len(history)
    assert isinstance(messages[0], ModelRequest)
    assert len(messages[0].parts) == 1
    assert isinstance(messages[0].parts[0], SystemPromptPart)
    assert messages[0].parts[0].content == "Summary of previous conversation:\n\nsummary body"
    assert any(
        isinstance(part, UserPromptPart) and str(part.content).startswith("user-0-")
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
    )
