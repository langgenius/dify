import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.cohere.llm.llm import CohereLargeLanguageModel


def test_validate_credentials_for_chat_model():
    model = CohereLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='command-light-chat',
            credentials={
                'api_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='command-light-chat',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
        }
    )


def test_validate_credentials_for_completion_model():
    model = CohereLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='command-light',
            credentials={
                'api_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='command-light',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
        }
    )


def test_invoke_completion_model():
    model = CohereLargeLanguageModel()

    credentials = {
        'api_key': os.environ.get('COHERE_API_KEY')
    }

    result = model.invoke(
        model='command-light',
        credentials=credentials,
        prompt_messages=[
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        model_parameters={
            'temperature': 0.0,
            'max_tokens': 1
        },
        stream=False,
        user="abc-123"
    )

    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0
    assert model._num_tokens_from_string('command-light', credentials, result.message.content) == 1


def test_invoke_stream_completion_model():
    model = CohereLargeLanguageModel()

    result = model.invoke(
        model='command-light',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
        },
        prompt_messages=[
            UserPromptMessage(
                content='Hello World!'
            )
        ],
        model_parameters={
            'temperature': 0.0,
            'max_tokens': 100
        },
        stream=True,
        user="abc-123"
    )

    assert isinstance(result, Generator)

    for chunk in result:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


def test_invoke_chat_model():
    model = CohereLargeLanguageModel()

    result = model.invoke(
        model='command-light-chat',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
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
            'temperature': 0.0,
            'p': 0.99,
            'presence_penalty': 0.0,
            'frequency_penalty': 0.0,
            'max_tokens': 10
        },
        stop=['How'],
        stream=False,
        user="abc-123"
    )

    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0

    for chunk in model._llm_result_to_stream(result):
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


def test_invoke_stream_chat_model():
    model = CohereLargeLanguageModel()

    result = model.invoke(
        model='command-light-chat',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
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
            'temperature': 0.0,
            'max_tokens': 100
        },
        stream=True,
        user="abc-123"
    )

    assert isinstance(result, Generator)

    for chunk in result:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True
        if chunk.delta.finish_reason is not None:
            assert chunk.delta.usage is not None
            assert chunk.delta.usage.completion_tokens > 0


def test_get_num_tokens():
    model = CohereLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model='command-light',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
        },
        prompt_messages=[
            UserPromptMessage(
                content='Hello World!'
            )
        ]
    )

    assert num_tokens == 3

    num_tokens = model.get_num_tokens(
        model='command-light-chat',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
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

    assert num_tokens == 15


def test_fine_tuned_model():
    model = CohereLargeLanguageModel()

    # test invoke
    result = model.invoke(
        model='85ec47be-6139-4f75-a4be-0f0ec1ef115c-ft',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY'),
            'mode': 'completion'
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
            'temperature': 0.0,
            'max_tokens': 100
        },
        stream=False,
        user="abc-123"
    )

    assert isinstance(result, LLMResult)


def test_fine_tuned_chat_model():
    model = CohereLargeLanguageModel()

    # test invoke
    result = model.invoke(
        model='94f2d55a-4c79-4c00-bde4-23962e74b170-ft',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY'),
            'mode': 'chat'
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
            'temperature': 0.0,
            'max_tokens': 100
        },
        stream=False,
        user="abc-123"
    )

    assert isinstance(result, LLMResult)
