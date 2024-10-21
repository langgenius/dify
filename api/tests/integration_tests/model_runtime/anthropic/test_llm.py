import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.anthropic.llm.llm import AnthropicLargeLanguageModel


@pytest.mark.parametrize("setup_anthropic_mock", [["none"]], indirect=True)
def test_validate_credentials(setup_anthropic_mock):
    model = AnthropicLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="claude-instant-1.2", credentials={"anthropic_api_key": "invalid_key"})

    model.validate_credentials(
        model="claude-instant-1.2", credentials={"anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY")}
    )


@pytest.mark.parametrize("setup_anthropic_mock", [["none"]], indirect=True)
def test_invoke_model(setup_anthropic_mock):
    model = AnthropicLargeLanguageModel()

    response = model.invoke(
        model="claude-instant-1.2",
        credentials={
            "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY"),
            "anthropic_api_url": os.environ.get("ANTHROPIC_API_URL"),
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        model_parameters={"temperature": 0.0, "top_p": 1.0, "max_tokens": 10},
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


@pytest.mark.parametrize("setup_anthropic_mock", [["none"]], indirect=True)
def test_invoke_stream_model(setup_anthropic_mock):
    model = AnthropicLargeLanguageModel()

    response = model.invoke(
        model="claude-instant-1.2",
        credentials={"anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        model_parameters={"temperature": 0.0, "max_tokens": 100},
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


def test_get_num_tokens():
    model = AnthropicLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="claude-instant-1.2",
        credentials={"anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
    )

    assert num_tokens == 18
