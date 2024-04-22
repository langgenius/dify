import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ParameterRule
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.localai.llm.llm import LocalAILarguageModel


def test_validate_credentials_for_chat_model():
    model = LocalAILarguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='chinese-llama-2-7b',
            credentials={
                'server_url': 'hahahaha',
                'completion_type': 'completion',
            }
        )

    model.validate_credentials(
        model='chinese-llama-2-7b',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'completion',
        }
    )

def test_invoke_completion_model():
    model = LocalAILarguageModel()

    response = model.invoke(
        model='chinese-llama-2-7b',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'completion',
        },
        prompt_messages=[
            UserPromptMessage(
                content='ping'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
            'max_tokens': 10
        },
        stop=[],
        user="abc-123",
        stream=False
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0
    assert response.usage.total_tokens > 0

def test_invoke_chat_model():
    model = LocalAILarguageModel()

    response = model.invoke(
        model='chinese-llama-2-7b',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'chat_completion',
        },
        prompt_messages=[
            UserPromptMessage(
                content='ping'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
            'max_tokens': 10
        },
        stop=[],
        user="abc-123",
        stream=False
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0
    assert response.usage.total_tokens > 0

def test_invoke_stream_completion_model():
    model = LocalAILarguageModel()

    response = model.invoke(
        model='chinese-llama-2-7b',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'completion',
        },
        prompt_messages=[
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
            'max_tokens': 10
        },
        stop=['you'],
        stream=True,
        user="abc-123"
    )

    assert isinstance(response, Generator)
    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True

def test_invoke_stream_chat_model():
    model = LocalAILarguageModel()

    response = model.invoke(
        model='chinese-llama-2-7b',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'chat_completion',
        },
        prompt_messages=[
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
            'max_tokens': 10
        },
        stop=['you'],
        stream=True,
        user="abc-123"
    )

    assert isinstance(response, Generator)
    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True

def test_get_num_tokens():
    model = LocalAILarguageModel()

    num_tokens = model.get_num_tokens(
        model='????',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'chat_completion',
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        tools=[
            PromptMessageTool(
                name='get_current_weather',
                description='Get the current weather in a given location',
                parameters={
                    "type": "object",
                    "properties": {
                        "location": {
                        "type": "string",
                            "description": "The city and state e.g. San Francisco, CA"
                        },
                        "unit": {
                            "type": "string",
                            "enum": [
                                "c",
                                "f"
                            ]
                        }
                    },
                    "required": [
                        "location"
                    ]
                }
            )
        ]
    )

    assert isinstance(num_tokens, int)
    assert num_tokens == 77

    num_tokens = model.get_num_tokens(
        model='????',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'chat_completion',
        },
        prompt_messages=[
            UserPromptMessage(
                content='Hello World!'
            )
        ],
    )

    assert isinstance(num_tokens, int)
    assert num_tokens == 10