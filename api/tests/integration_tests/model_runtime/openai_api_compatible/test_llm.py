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
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel

"""
Using Together.ai's OpenAI-compatible API as testing endpoint
"""


def test_validate_credentials():
    model = OAIAPICompatLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='mistralai/Mixtral-8x7B-Instruct-v0.1',
            credentials={
                'api_key': 'invalid_key',
                'endpoint_url': 'https://api.together.xyz/v1/',
                'mode': 'chat'
            }
        )

    model.validate_credentials(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
            'endpoint_url': 'https://api.together.xyz/v1/',
            'mode': 'chat'
        }
    )


def test_invoke_model():
    model = OAIAPICompatLargeLanguageModel()

    response = model.invoke(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
            'endpoint_url': 'https://api.together.xyz/v1/',
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
    model = OAIAPICompatLargeLanguageModel()

    response = model.invoke(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
            'endpoint_url': 'https://api.together.xyz/v1/',
            'mode': 'chat',
            'stream_mode_delimiter': '\\n\\n'
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


def test_invoke_stream_model_without_delimiter():
    model = OAIAPICompatLargeLanguageModel()

    response = model.invoke(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('TOGETHER_API_KEY'),
            'endpoint_url': 'https://api.together.xyz/v1/',
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


# using OpenAI's ChatGPT-3.5 as testing endpoint
def test_invoke_chat_model_with_tools():
    model = OAIAPICompatLargeLanguageModel()

    result = model.invoke(
        model='gpt-3.5-turbo',
        credentials={
            'api_key': os.environ.get('OPENAI_API_KEY'),
            'endpoint_url': 'https://api.openai.com/v1/',
            'mode': 'chat'
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content="what's the weather today in London?",
            )
        ],
        tools=[
            PromptMessageTool(
                name='get_weather',
                description='Determine weather in my location',
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
                                "celsius",
                                "fahrenheit"
                            ]
                        }
                    },
                    "required": [
                        "location"
                    ]
                }
            ),
        ],
        model_parameters={
            'temperature': 0.0,
            'max_tokens': 1024
        },
        stream=False,
        user="abc-123"
    )

    assert isinstance(result, LLMResult)
    assert isinstance(result.message, AssistantPromptMessage)
    assert len(result.message.tool_calls) > 0


def test_get_num_tokens():
    model = OAIAPICompatLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model='mistralai/Mixtral-8x7B-Instruct-v0.1',
        credentials={
            'api_key': os.environ.get('OPENAI_API_KEY'),
            'endpoint_url': 'https://api.openai.com/v1/'
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
