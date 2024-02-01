import os
from typing import Generator

import pytest
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (AssistantPromptMessage, PromptMessageTool,
                                                          SystemPromptMessage, UserPromptMessage)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.zhipuai.llm.llm import ZhipuAILargeLanguageModel


def test_validate_credentials():
    model = ZhipuAILargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='chatglm_turbo',
            credentials={
                'api_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='chatglm_turbo',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
        }
    )


def test_invoke_model():
    model = ZhipuAILargeLanguageModel()

    response = model.invoke(
        model='chatglm_turbo',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
        },
        prompt_messages=[
            UserPromptMessage(
                content='Who are you?'
            )
        ],
        model_parameters={
            'temperature': 0.9,
            'top_p': 0.7
        },
        stop=['How'],
        stream=False,
        user="abc-123"
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


def test_invoke_stream_model():
    model = ZhipuAILargeLanguageModel()

    response = model.invoke(
        model='chatglm_turbo',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
        },
        prompt_messages=[
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        model_parameters={
            'temperature': 0.9,
            'top_p': 0.7
        },
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
    model = ZhipuAILargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model='chatglm_turbo',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
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

    assert num_tokens == 14

def test_get_tools_num_tokens():
    model = ZhipuAILargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model='tools',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
        },
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
        ],
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello World!'
            )
        ]
    )

    assert num_tokens == 108