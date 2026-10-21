from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from tests.unit_tests.core.model_fixtures import make_model_config, make_token_buffer_memory


def test_get_prompt(mocker: MockerFixture) -> None:
    prompt_messages: list[PromptMessage] = [
        SystemPromptMessage(content="System Template"),
        UserPromptMessage(content="User Query"),
    ]
    history_messages: list[PromptMessage] = [
        SystemPromptMessage(content="System Prompt 1"),
        UserPromptMessage(content="User Prompt 1"),
        AssistantPromptMessage(content="Assistant Thought 1"),
        ToolPromptMessage(content="Tool 1-1", name="Tool 1-1", tool_call_id="1"),
        ToolPromptMessage(content="Tool 1-2", name="Tool 1-2", tool_call_id="2"),
        SystemPromptMessage(content="System Prompt 2"),
        UserPromptMessage(content="User Prompt 2"),
        AssistantPromptMessage(content="Assistant Thought 2"),
        ToolPromptMessage(content="Tool 2-1", name="Tool 2-1", tool_call_id="3"),
        ToolPromptMessage(content="Tool 2-2", name="Tool 2-2", tool_call_id="4"),
        UserPromptMessage(content="User Prompt 3"),
        AssistantPromptMessage(content="Assistant Thought 3"),
    ]

    # use message number instead of token for testing
    def side_effect_get_num_tokens(*args: object) -> int:
        prompt_messages = args[2]
        assert isinstance(prompt_messages, list)
        return len(prompt_messages)

    model_config = make_model_config(provider="openai", model="gpt-4", mode="chat")
    mocker.patch.object(
        model_config.provider_model_bundle.model_type_instance, "get_num_tokens", side_effect=side_effect_get_num_tokens
    )
    memory = make_token_buffer_memory(model_config)

    transform = AgentHistoryPromptTransform(
        model_config=model_config,
        prompt_messages=prompt_messages,
        history_messages=history_messages,
        memory=memory,
    )

    max_token_limit = 5
    transform._calculate_rest_token = MagicMock(return_value=max_token_limit)
    result = transform.get_prompt()

    assert len(result) == 4

    max_token_limit = 20
    transform._calculate_rest_token = MagicMock(return_value=max_token_limit)
    result = transform.get_prompt()

    assert len(result) == 12


@pytest.mark.parametrize("observation_name", ["agent_observation", "knowledge_retrieval"])
def test_history_limit_keeps_complete_agent_turns(mocker: MockerFixture, observation_name: str) -> None:
    history = [
        UserPromptMessage(content="Earlier query"),
        AssistantPromptMessage(content="Earlier thought", opaque_body={"signature": "signed"}),
        UserPromptMessage(content="Tool observation", name=observation_name),
        AssistantPromptMessage(content="Earlier answer"),
        UserPromptMessage(content="Latest query"),
        AssistantPromptMessage(content="Latest answer"),
    ]
    model_config = make_model_config(provider="openai", model="gpt-4", mode="chat")
    mocker.patch.object(
        model_config.provider_model_bundle.model_type_instance,
        "get_num_tokens",
        side_effect=lambda _model, _credentials, messages: len(messages),
    )
    transform = AgentHistoryPromptTransform(
        model_config=model_config,
        prompt_messages=[],
        history_messages=history,
        memory=make_token_buffer_memory(model_config),
    )
    mocker.patch.object(transform, "_calculate_rest_token", return_value=4)

    assert transform.get_prompt() == history[-2:]
