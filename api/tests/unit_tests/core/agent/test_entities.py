"""Unit tests for core.agent.entities.

Covers the Agent entity models: AgentToolEntity, AgentPromptEntity,
AgentScratchpadUnit (including its Action payload and ``is_final`` predicate),
AgentEntity and its Strategy enum, and the AgentInvokeMessage subtype.

These are plain Pydantic models with no external services, so the tests pin the
model defaults, validation boundaries, and the ``is_final`` string matching that
the agent runner relies on to detect a terminal answer action.
"""

import pytest
from pydantic import ValidationError

from core.agent.entities import (
    AgentEntity,
    AgentInvokeMessage,
    AgentPromptEntity,
    AgentScratchpadUnit,
    AgentToolEntity,
)
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType

# =========================================================
# AgentToolEntity
# =========================================================


def test_agent_tool_entity_defaults() -> None:
    entity = AgentToolEntity(
        provider_type=ToolProviderType.BUILT_IN,
        provider_id="provider",
        tool_name="tool",
    )

    assert entity.provider_type == ToolProviderType.BUILT_IN
    assert entity.provider_id == "provider"
    assert entity.tool_name == "tool"
    assert entity.tool_parameters == {}
    assert entity.plugin_unique_identifier is None
    assert entity.credential_id is None


def test_agent_tool_entity_keeps_explicit_optional_fields() -> None:
    entity = AgentToolEntity(
        provider_type=ToolProviderType.PLUGIN,
        provider_id="provider",
        tool_name="tool",
        tool_parameters={"query": "hello"},
        plugin_unique_identifier="plugin@1",
        credential_id="credential",
    )

    assert entity.tool_parameters == {"query": "hello"}
    assert entity.plugin_unique_identifier == "plugin@1"
    assert entity.credential_id == "credential"


def test_agent_tool_entity_does_not_share_default_parameters_dict() -> None:
    first = AgentToolEntity(provider_type=ToolProviderType.BUILT_IN, provider_id="p", tool_name="t")
    second = AgentToolEntity(provider_type=ToolProviderType.BUILT_IN, provider_id="p", tool_name="t")

    first.tool_parameters["query"] = "hello"

    assert second.tool_parameters == {}


def test_agent_tool_entity_requires_core_fields() -> None:
    with pytest.raises(ValidationError):
        AgentToolEntity(provider_type=ToolProviderType.BUILT_IN, tool_name="tool")  # type: ignore[call-arg]


# =========================================================
# AgentPromptEntity
# =========================================================


def test_agent_prompt_entity_requires_both_prompts() -> None:
    with pytest.raises(ValidationError):
        AgentPromptEntity(first_prompt="only the first prompt")  # type: ignore[call-arg]


def test_agent_prompt_entity_keeps_prompts() -> None:
    entity = AgentPromptEntity(first_prompt="first", next_iteration="next")

    assert entity.first_prompt == "first"
    assert entity.next_iteration == "next"


# =========================================================
# AgentScratchpadUnit.Action
# =========================================================


def test_action_to_dict_keeps_dict_input() -> None:
    action = AgentScratchpadUnit.Action(action_name="search", action_input={"query": "hello"})

    assert action.to_dict() == {"action": "search", "action_input": {"query": "hello"}}


def test_action_to_dict_keeps_string_input() -> None:
    action = AgentScratchpadUnit.Action(action_name="search", action_input="hello")

    assert action.to_dict() == {"action": "search", "action_input": "hello"}


# =========================================================
# AgentScratchpadUnit.is_final
# =========================================================


def test_scratchpad_unit_defaults_to_open_ended() -> None:
    unit = AgentScratchpadUnit()

    assert unit.agent_response is None
    assert unit.thought is None
    assert unit.action_str is None
    assert unit.observation is None
    assert unit.action is None


def test_scratchpad_is_final_without_action() -> None:
    assert AgentScratchpadUnit().is_final() is True


@pytest.mark.parametrize(
    "action_name",
    [
        "Final Answer",
        "FINAL ANSWER",
        "final_answer",
        "final answer tool",
        "Answer Final",
        "final-answer",
    ],
)
def test_scratchpad_is_final_when_name_contains_final_and_answer(action_name: str) -> None:
    unit = AgentScratchpadUnit(action=AgentScratchpadUnit.Action(action_name=action_name, action_input={}))

    assert unit.is_final() is True


@pytest.mark.parametrize(
    "action_name",
    [
        "final",
        "finalize",
        "answer",
        "search",
        "",
        "final_search",
        "answer_question",
    ],
)
def test_scratchpad_is_not_final_without_both_keywords(action_name: str) -> None:
    unit = AgentScratchpadUnit(action=AgentScratchpadUnit.Action(action_name=action_name, action_input={}))

    assert unit.is_final() is False


def test_scratchpad_is_final_matches_case_insensitively() -> None:
    unit = AgentScratchpadUnit(action=AgentScratchpadUnit.Action(action_name="FiNaL aNsWeR", action_input={}))

    assert unit.is_final() is True


# =========================================================
# AgentEntity
# =========================================================


def test_agent_entity_strategy_values() -> None:
    assert AgentEntity.Strategy.CHAIN_OF_THOUGHT.value == "chain-of-thought"
    assert AgentEntity.Strategy.FUNCTION_CALLING.value == "function-calling"


def test_agent_entity_defaults() -> None:
    entity = AgentEntity(
        provider="provider",
        model="model",
        strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
    )

    assert entity.max_iteration == 10
    assert entity.prompt is None
    assert entity.tools is None


def test_agent_entity_keeps_nested_configuration() -> None:
    entity = AgentEntity(
        provider="provider",
        model="model",
        strategy=AgentEntity.Strategy.FUNCTION_CALLING,
        prompt=AgentPromptEntity(first_prompt="first", next_iteration="next"),
        tools=[AgentToolEntity(provider_type=ToolProviderType.BUILT_IN, provider_id="p", tool_name="t")],
        max_iteration=3,
    )

    assert entity.prompt is not None
    assert entity.prompt.first_prompt == "first"
    assert entity.tools is not None
    assert len(entity.tools) == 1
    assert entity.max_iteration == 3


def test_agent_entity_rejects_unknown_strategy() -> None:
    with pytest.raises(ValidationError):
        AgentEntity(provider="provider", model="model", strategy="unknown-strategy")  # type: ignore[arg-type]


# =========================================================
# AgentInvokeMessage
# =========================================================


def test_agent_invoke_message_subclasses_tool_invoke_message() -> None:
    assert issubclass(AgentInvokeMessage, ToolInvokeMessage)
