import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.azure_ai_studio.llm.llm import AzureAIStudioLargeLanguageModel
from tests.integration_tests.model_runtime.__mock.azure_ai_studio import setup_azure_ai_studio_mock


@pytest.mark.parametrize("setup_azure_ai_studio_mock", [["chat"]], indirect=True)
def test_validate_credentials(setup_azure_ai_studio_mock):
    model = AzureAIStudioLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="gpt-35-turbo",
            credentials={"api_key": "invalid_key", "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE")},
        )

    model.validate_credentials(
        model="gpt-35-turbo",
        credentials={
            "api_key": os.getenv("AZURE_AI_STUDIO_API_KEY"),
            "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE"),
        },
    )


@pytest.mark.parametrize("setup_azure_ai_studio_mock", [["chat"]], indirect=True)
def test_invoke_model(setup_azure_ai_studio_mock):
    model = AzureAIStudioLargeLanguageModel()

    result = model.invoke(
        model="gpt-35-turbo",
        credentials={
            "api_key": os.getenv("AZURE_AI_STUDIO_API_KEY"),
            "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE"),
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        model_parameters={"temperature": 0.0, "max_tokens": 100},
        stream=False,
        user="abc-123",
    )

    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0


@pytest.mark.parametrize("setup_azure_ai_studio_mock", [["chat"]], indirect=True)
def test_invoke_stream_model(setup_azure_ai_studio_mock):
    model = AzureAIStudioLargeLanguageModel()

    result = model.invoke(
        model="gpt-35-turbo",
        credentials={
            "api_key": os.getenv("AZURE_AI_STUDIO_API_KEY"),
            "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE"),
        },
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

    assert isinstance(result, Generator)

    for chunk in result:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        if chunk.delta.finish_reason is not None:
            assert chunk.delta.usage is not None
            assert chunk.delta.usage.completion_tokens > 0


def test_get_num_tokens():
    model = AzureAIStudioLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="gpt-35-turbo",
        credentials={
            "api_key": os.getenv("AZURE_AI_STUDIO_API_KEY"),
            "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE"),
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
    )

    assert num_tokens == 21
