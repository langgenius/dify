import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openllm.llm.llm import OpenLLMLargeLanguageModel


def test_validate_credentials_for_chat_model():
    model = OpenLLMLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="NOT IMPORTANT",
            credentials={
                "server_url": "invalid_key",
            },
        )

    model.validate_credentials(
        model="NOT IMPORTANT",
        credentials={
            "server_url": os.environ.get("OPENLLM_SERVER_URL"),
        },
    )


def test_invoke_model():
    model = OpenLLMLargeLanguageModel()

    response = model.invoke(
        model="NOT IMPORTANT",
        credentials={
            "server_url": os.environ.get("OPENLLM_SERVER_URL"),
        },
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        model_parameters={
            "temperature": 0.7,
            "top_p": 1.0,
            "top_k": 1,
        },
        stop=["you"],
        user="abc-123",
        stream=False,
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0
    assert response.usage.total_tokens > 0


def test_invoke_stream_model():
    model = OpenLLMLargeLanguageModel()

    response = model.invoke(
        model="NOT IMPORTANT",
        credentials={
            "server_url": os.environ.get("OPENLLM_SERVER_URL"),
        },
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        model_parameters={
            "temperature": 0.7,
            "top_p": 1.0,
            "top_k": 1,
        },
        stop=["you"],
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
    model = OpenLLMLargeLanguageModel()

    response = model.get_num_tokens(
        model="NOT IMPORTANT",
        credentials={
            "server_url": os.environ.get("OPENLLM_SERVER_URL"),
        },
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        tools=[],
    )

    assert isinstance(response, int)
    assert response == 3
