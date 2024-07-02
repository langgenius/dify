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
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.xinference.llm.llm import XinferenceAILargeLanguageModel

"""FOR MOCK FIXTURES, DO NOT REMOVE"""
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock
from tests.integration_tests.model_runtime.__mock.xinference import setup_xinference_mock


@pytest.mark.parametrize('setup_openai_mock, setup_xinference_mock', [['chat', 'none']], indirect=True)
def test_validate_credentials_for_chat_model(setup_openai_mock, setup_xinference_mock):
    model = XinferenceAILargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='ChatGLM3',
            credentials={
                'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
                'model_uid': 'www ' + os.environ.get('XINFERENCE_CHAT_MODEL_UID')
            }
        )

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='aaaaa',
            credentials={
                'server_url': '',
                'model_uid': ''
            }
        )

    model.validate_credentials(
        model='ChatGLM3',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_CHAT_MODEL_UID')
        }
    )

@pytest.mark.parametrize('setup_openai_mock, setup_xinference_mock', [['chat', 'none']], indirect=True)
def test_invoke_chat_model(setup_openai_mock, setup_xinference_mock):
    model = XinferenceAILargeLanguageModel()

    response = model.invoke(
        model='ChatGLM3',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_CHAT_MODEL_UID')
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
        },
        stop=['you'],
        user="abc-123",
        stream=False
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0
    assert response.usage.total_tokens > 0

@pytest.mark.parametrize('setup_openai_mock, setup_xinference_mock', [['chat', 'none']], indirect=True)
def test_invoke_stream_chat_model(setup_openai_mock, setup_xinference_mock):
    model = XinferenceAILargeLanguageModel()

    response = model.invoke(
        model='ChatGLM3',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_CHAT_MODEL_UID')
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
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
"""
    Funtion calling of xinference does not support stream mode currently
"""
# def test_invoke_stream_chat_model_with_functions():
#     model = XinferenceAILargeLanguageModel()

#     response = model.invoke(
#         model='ChatGLM3-6b',
#         credentials={
#             'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
#             'model_type': 'text-generation',
#             'model_name': 'ChatGLM3',
#             'model_uid': os.environ.get('XINFERENCE_CHAT_MODEL_UID')
#         },
#         prompt_messages=[
#             SystemPromptMessage(
#                 content='你是一个天气机器人，可以通过调用函数来获取天气信息',
#             ),
#             UserPromptMessage(
#                 content='波士顿天气如何？'
#             )
#         ],
#         model_parameters={
#             'temperature': 0,
#             'top_p': 1.0,
#         },
#         stop=['you'],
#         user='abc-123',
#         stream=True,
#         tools=[
#             PromptMessageTool(
#                 name='get_current_weather',
#                 description='Get the current weather in a given location',
#                 parameters={
#                     "type": "object",
#                     "properties": {
#                         "location": {
#                         "type": "string",
#                             "description": "The city and state e.g. San Francisco, CA"
#                         },
#                         "unit": {
#                             "type": "string",
#                             "enum": ["celsius", "fahrenheit"]
#                         }
#                     },
#                     "required": [
#                         "location"
#                     ]
#                 }
#             )
#         ]
#     )

#     assert isinstance(response, Generator)
    
#     call: LLMResultChunk = None
#     chunks = []

#     for chunk in response:
#         chunks.append(chunk)
#         assert isinstance(chunk, LLMResultChunk)
#         assert isinstance(chunk.delta, LLMResultChunkDelta)
#         assert isinstance(chunk.delta.message, AssistantPromptMessage)
#         assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True

#         if chunk.delta.message.tool_calls and len(chunk.delta.message.tool_calls) > 0:
#             call = chunk
#             break

#     assert call is not None
#     assert call.delta.message.tool_calls[0].function.name == 'get_current_weather'

# def test_invoke_chat_model_with_functions():
#     model = XinferenceAILargeLanguageModel()

#     response = model.invoke(
#         model='ChatGLM3-6b',
#         credentials={
#             'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
#             'model_type': 'text-generation',
#             'model_name': 'ChatGLM3',
#             'model_uid': os.environ.get('XINFERENCE_CHAT_MODEL_UID')
#         },
#         prompt_messages=[
#             UserPromptMessage(
#                 content='What is the weather like in San Francisco?'
#             )
#         ],
#         model_parameters={
#             'temperature': 0.7,
#             'top_p': 1.0,
#         },
#         stop=['you'],
#         user='abc-123',
#         stream=False,
#         tools=[
#             PromptMessageTool(
#                 name='get_current_weather',
#                 description='Get the current weather in a given location',
#                 parameters={
#                     "type": "object",
#                     "properties": {
#                         "location": {
#                         "type": "string",
#                             "description": "The city and state e.g. San Francisco, CA"
#                         },
#                         "unit": {
#                             "type": "string",
#                             "enum": [
#                                 "c",
#                                 "f"
#                             ]
#                         }
#                     },
#                     "required": [
#                         "location"
#                     ]
#                 }
#             )
#         ]
#     )

#     assert isinstance(response, LLMResult)
#     assert len(response.message.content) > 0
#     assert response.usage.total_tokens > 0
#     assert response.message.tool_calls[0].function.name == 'get_current_weather'

@pytest.mark.parametrize('setup_openai_mock, setup_xinference_mock', [['completion', 'none']], indirect=True)
def test_validate_credentials_for_generation_model(setup_openai_mock, setup_xinference_mock):
    model = XinferenceAILargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='alapaca',
            credentials={
                'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
                'model_uid': 'www ' + os.environ.get('XINFERENCE_GENERATION_MODEL_UID')
            }
        )

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='alapaca',
            credentials={
                'server_url': '',
                'model_uid': ''
            }
        )

    model.validate_credentials(
        model='alapaca',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_GENERATION_MODEL_UID')
        }
    )

@pytest.mark.parametrize('setup_openai_mock, setup_xinference_mock', [['completion', 'none']], indirect=True)
def test_invoke_generation_model(setup_openai_mock, setup_xinference_mock):
    model = XinferenceAILargeLanguageModel()

    response = model.invoke(
        model='alapaca',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_GENERATION_MODEL_UID')
        },
        prompt_messages=[
            UserPromptMessage(
                content='the United States is'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
        },
        stop=['you'],
        user="abc-123",
        stream=False
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0
    assert response.usage.total_tokens > 0

@pytest.mark.parametrize('setup_openai_mock, setup_xinference_mock', [['completion', 'none']], indirect=True)
def test_invoke_stream_generation_model(setup_openai_mock, setup_xinference_mock):
    model = XinferenceAILargeLanguageModel()

    response = model.invoke(
        model='alapaca',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_GENERATION_MODEL_UID')
        },
        prompt_messages=[
            UserPromptMessage(
                content='the United States is'
            )
        ],
        model_parameters={
            'temperature': 0.7,
            'top_p': 1.0,
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
    model = XinferenceAILargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model='ChatGLM3',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_GENERATION_MODEL_UID')
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
        model='ChatGLM3',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_GENERATION_MODEL_UID')
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello World!'
            )
        ],
    )

    assert isinstance(num_tokens, int)
    assert num_tokens == 21