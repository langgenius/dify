import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.replicate.llm.llm import ReplicateLargeLanguageModel


def test_validate_credentials():
    model = ReplicateLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='meta/llama-2-13b-chat',
            credentials={
                'replicate_api_token': 'invalid_key',
                'model_version': 'f4e2de70d66816a838a89eeeb621910adffb0dd0baba3976c96980970978018d'
            }
        )

    model.validate_credentials(
        model='meta/llama-2-13b-chat',
        credentials={
            'replicate_api_token': os.environ.get('REPLICATE_API_KEY'),
            'model_version': 'f4e2de70d66816a838a89eeeb621910adffb0dd0baba3976c96980970978018d'
        }
    )


def test_invoke_model():
    model = ReplicateLargeLanguageModel()

    response = model.invoke(
        model='meta/llama-2-13b-chat',
        credentials={
            'replicate_api_token': os.environ.get('REPLICATE_API_KEY'),
            'model_version': 'f4e2de70d66816a838a89eeeb621910adffb0dd0baba3976c96980970978018d'
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
    model = ReplicateLargeLanguageModel()

    response = model.invoke(
        model='mistralai/mixtral-8x7b-instruct-v0.1',
        credentials={
            'replicate_api_token': os.environ.get('REPLICATE_API_KEY'),
            'model_version': '2b56576fcfbe32fa0526897d8385dd3fb3d36ba6fd0dbe033c72886b81ade93e'
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
    model = ReplicateLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model='',
        credentials={
            'replicate_api_token': os.environ.get('REPLICATE_API_KEY'),
            'model_version': '2b56576fcfbe32fa0526897d8385dd3fb3d36ba6fd0dbe033c72886b81ade93e'
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
