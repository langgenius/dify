import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.togetherai.llm.llm import TogetherAILargeLanguageModel


def test_validate_credentials():
    model = TogetherAILargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='mistralai/Mixtral-8x7B-Instruct-v0.1',
            credentials={
                'api_key': 'invalid_key',
                'mode': 'chat'
            }
        )

    model.validate_credentials(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
            'mode': 'chat'
        }
    )

def test_invoke_model():
    model = TogetherAILargeLanguageModel()

    response = model.invoke(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
            'mode': 'completion'
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Who are you?'
            )
        ],
        model_parameters={
            'temperature': 1.0,
            'top_k': 2,
            'top_p': 0.5,
        },
        stop=['How'],
        stream=False,
        user="abc-123"
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0

def test_invoke_stream_model():
    model = TogetherAILargeLanguageModel()

    response = model.invoke(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
            'mode': 'chat'
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Who are you?'
            )
        ],
        model_parameters={
            'temperature': 1.0,
            'top_k': 2,
            'top_p': 0.5,
        },
        stop=['How'],
        stream=True,
        user="abc-123"
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)

def test_get_num_tokens():
    model = TogetherAILargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello World!'
            )
        ]
    )

    assert isinstance(num_tokens, int)
    assert num_tokens == 21
