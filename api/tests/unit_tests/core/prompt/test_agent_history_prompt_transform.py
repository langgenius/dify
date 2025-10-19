from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import (
    ModelConfigWithCredentialsEntity,
)
from core.entities.provider_configuration import ProviderModelBundle
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform
from models.model import Conversation


def test_get_prompt():
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

    large_language_model_mock = MagicMock(spec=LargeLanguageModel)
    large_language_model_mock.get_num_tokens = MagicMock(side_effect=side_effect_get_num_tokens)

    provider_model_bundle_mock = MagicMock(spec=ProviderModelBundle)
    provider_model_bundle_mock.model_type_instance = large_language_model_mock

    model_config_mock = MagicMock(spec=ModelConfigWithCredentialsEntity)
    model_config_mock.model = "openai"
    model_config_mock.credentials = {}
    model_config_mock.provider_model_bundle = provider_model_bundle_mock

    memory = TokenBufferMemory(conversation=Conversation(), model_instance=model_config_mock)

    transform = AgentHistoryPromptTransform(
        model_config=model_config_mock,
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
