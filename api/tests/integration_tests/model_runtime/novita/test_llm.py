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
from core.model_runtime.model_providers.novita.llm.llm import NovitaLargeLanguageModel


def test_validate_credentials():
    model = NovitaLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="meta-llama/llama-3-8b-instruct", credentials={"api_key": "invalid_key", "mode": "chat"}
        )

    model.validate_credentials(
        model="meta-llama/llama-3-8b-instruct",
        credentials={"api_key": os.environ.get("NOVITA_API_KEY"), "mode": "chat"},
    )


def test_invoke_model():
    model = NovitaLargeLanguageModel()

    response = model.invoke(
        model="meta-llama/llama-3-8b-instruct",
        credentials={"api_key": os.environ.get("NOVITA_API_KEY"), "mode": "completion"},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Who are you?"),
        ],
        model_parameters={
            "temperature": 1.0,
            "top_p": 0.5,
            "max_tokens": 10,
        },
        stop=["How"],
        stream=False,
        user="novita",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


def test_invoke_stream_model():
    model = NovitaLargeLanguageModel()

    response = model.invoke(
        model="meta-llama/llama-3-8b-instruct",
        credentials={"api_key": os.environ.get("NOVITA_API_KEY"), "mode": "chat"},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Who are you?"),
        ],
        model_parameters={"temperature": 1.0, "top_k": 2, "top_p": 0.5, "max_tokens": 100},
        stream=True,
        user="novita",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)


def test_get_num_tokens():
    model = NovitaLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="meta-llama/llama-3-8b-instruct",
        credentials={
            "api_key": os.environ.get("NOVITA_API_KEY"),
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
