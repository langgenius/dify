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
from core.model_runtime.model_providers.vessl_ai.llm.llm import VesslAILargeLanguageModel


def test_validate_credentials():
    model = VesslAILargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model=os.environ.get("VESSL_AI_MODEL_NAME"),
            credentials={
                "api_key": "invalid_key",
                "endpoint_url": os.environ.get("VESSL_AI_ENDPOINT_URL"),
                "mode": "chat",
            },
        )

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model=os.environ.get("VESSL_AI_MODEL_NAME"),
            credentials={
                "api_key": os.environ.get("VESSL_AI_API_KEY"),
                "endpoint_url": "http://invalid_url",
                "mode": "chat",
            },
        )

    model.validate_credentials(
        model=os.environ.get("VESSL_AI_MODEL_NAME"),
        credentials={
            "api_key": os.environ.get("VESSL_AI_API_KEY"),
            "endpoint_url": os.environ.get("VESSL_AI_ENDPOINT_URL"),
            "mode": "chat",
        },
    )


def test_invoke_model():
    model = VesslAILargeLanguageModel()

    response = model.invoke(
        model=os.environ.get("VESSL_AI_MODEL_NAME"),
        credentials={
            "api_key": os.environ.get("VESSL_AI_API_KEY"),
            "endpoint_url": os.environ.get("VESSL_AI_ENDPOINT_URL"),
            "mode": "chat",
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Who are you?"),
        ],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


def test_invoke_stream_model():
    model = VesslAILargeLanguageModel()

    response = model.invoke(
        model=os.environ.get("VESSL_AI_MODEL_NAME"),
        credentials={
            "api_key": os.environ.get("VESSL_AI_API_KEY"),
            "endpoint_url": os.environ.get("VESSL_AI_ENDPOINT_URL"),
            "mode": "chat",
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Who are you?"),
        ],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)


def test_get_num_tokens():
    model = VesslAILargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model=os.environ.get("VESSL_AI_MODEL_NAME"),
        credentials={
            "api_key": os.environ.get("VESSL_AI_API_KEY"),
            "endpoint_url": os.environ.get("VESSL_AI_ENDPOINT_URL"),
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
    )

    assert isinstance(num_tokens, int)
    assert num_tokens == 21
