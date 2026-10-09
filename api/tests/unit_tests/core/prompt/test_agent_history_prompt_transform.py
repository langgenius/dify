from unittest.mock import MagicMock

from pytest_mock import MockerFixture

from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from tests.unit_tests.core.model_fixtures import make_model_config, make_token_buffer_memory


def test_get_prompt(mocker: MockerFixture):
    prompt_messages = [
        SystemPromptMessage(content="System Template"),
        UserPromptMessage(content="User Query"),
    ]
    history_messages = [
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
    def side_effect_get_num_tokens(*args):
        return len(args[2])

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
