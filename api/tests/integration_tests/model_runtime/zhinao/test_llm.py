import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.zhinao.llm.llm import ZhinaoLargeLanguageModel


def test_validate_credentials():
    model = ZhinaoLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="360gpt2-pro", credentials={"api_key": "invalid_key"})

    model.validate_credentials(model="360gpt2-pro", credentials={"api_key": os.environ.get("ZHINAO_API_KEY")})


def test_invoke_model():
    model = ZhinaoLargeLanguageModel()

    response = model.invoke(
        model="360gpt2-pro",
        credentials={"api_key": os.environ.get("ZHINAO_API_KEY")},
        prompt_messages=[UserPromptMessage(content="Who are you?")],
        model_parameters={"temperature": 0.5, "max_tokens": 10},
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


def test_invoke_stream_model():
    model = ZhinaoLargeLanguageModel()

    response = model.invoke(
        model="360gpt2-pro",
        credentials={"api_key": os.environ.get("ZHINAO_API_KEY")},
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        model_parameters={"temperature": 0.5, "max_tokens": 100, "seed": 1234},
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
    model = ZhinaoLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="360gpt2-pro",
        credentials={"api_key": os.environ.get("ZHINAO_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
    )

    assert num_tokens == 21
