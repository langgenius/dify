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
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gitee_ai.llm.llm import GiteeAILargeLanguageModel


def test_predefined_models():
    model = GiteeAILargeLanguageModel()
    model_schemas = model.predefined_models()

    assert len(model_schemas) >= 1
    assert isinstance(model_schemas[0], AIModelEntity)


def test_validate_credentials_for_chat_model():
    model = GiteeAILargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        # model name to gpt-3.5-turbo because of mocking
        model.validate_credentials(model="gpt-3.5-turbo", credentials={"api_key": "invalid_key"})

    model.validate_credentials(
        model="Qwen2-7B-Instruct",
        credentials={"api_key": os.environ.get("GITEE_AI_API_KEY")},
    )


def test_invoke_chat_model():
    model = GiteeAILargeLanguageModel()

    result = model.invoke(
        model="Qwen2-7B-Instruct",
        credentials={"api_key": os.environ.get("GITEE_AI_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        model_parameters={
            "temperature": 0.0,
            "top_p": 1.0,
            "presence_penalty": 0.0,
            "frequency_penalty": 0.0,
            "max_tokens": 10,
            "stream": False,
        },
        stop=["How"],
        stream=False,
        user="foo",
    )

    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0


def test_invoke_stream_chat_model():
    model = GiteeAILargeLanguageModel()

    result = model.invoke(
        model="Qwen2-7B-Instruct",
        credentials={"api_key": os.environ.get("GITEE_AI_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        model_parameters={"temperature": 0.0, "max_tokens": 100, "stream": False},
        stream=True,
        user="foo",
    )

    assert isinstance(result, Generator)

    for chunk in result:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True
        if chunk.delta.finish_reason is not None:
            assert chunk.delta.usage is not None


def test_get_num_tokens():
    model = GiteeAILargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="Qwen2-7B-Instruct",
        credentials={"api_key": os.environ.get("GITEE_AI_API_KEY")},
        prompt_messages=[UserPromptMessage(content="Hello World!")],
    )

    assert num_tokens == 10

    num_tokens = model.get_num_tokens(
        model="Qwen2-7B-Instruct",
        credentials={"api_key": os.environ.get("GITEE_AI_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        tools=[
            PromptMessageTool(
                name="get_weather",
                description="Determine weather in my location",
                parameters={
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "The city and state e.g. San Francisco, CA"},
                        "unit": {"type": "string", "enum": ["c", "f"]},
                    },
                    "required": ["location"],
                },
            ),
        ],
    )

    assert num_tokens == 77
