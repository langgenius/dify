import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.sambanova.llm.llm import SambanovaLargeLanguageModel
from tests.integration_tests.conftest import _load_env
from tests.integration_tests.model_runtime.__mock.anthropic import setup_anthropic_mock

_load_env()


def test_validate_credentials():
    model = SambanovaLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="Meta-Llama-3.1-8B-Instruct", credentials={"sambanova_api_key": "invalid_key"})

    model.validate_credentials(
        model="Meta-Llama-3.1-8B-Instruct", credentials={"sambanova_api_key": os.environ.get("SAMBANOVA_API_KEY")}
    )


def test_invoke_model():
    model = SambanovaLargeLanguageModel()

    # completion
    response = model.invoke(
        model="Meta-Llama-3.1-8B-Instruct",
        credentials={
            "sambanova_api_key": os.environ.get("SAMBANOVA_API_KEY"),
            "sambanova_api_url": os.environ.get("SAMBANOVA_API_URL"),
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


def test_invoke_stream_model():
    model = SambanovaLargeLanguageModel()

    response = model.invoke(
        model="Meta-Llama-3.1-8B-Instruct",
        credentials={"sambanova_api_key": os.environ.get("SAMBANOVA_API_KEY")},
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
    model = SambanovaLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="Meta-Llama-3.1-8B-Instruct",
        credentials={"sambanova_api_key": os.environ.get("SAMBANOVA_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        model_parameters={"temperature": 0.0},
    )

    assert num_tokens == 25
