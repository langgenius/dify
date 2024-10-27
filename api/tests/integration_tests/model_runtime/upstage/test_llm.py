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
from core.model_runtime.entities.model_entities import AIModelEntity, ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.upstage.llm.llm import UpstageLargeLanguageModel

"""FOR MOCK FIXTURES, DO NOT REMOVE"""
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock


def test_predefined_models():
    model = UpstageLargeLanguageModel()
    model_schemas = model.predefined_models()

    assert len(model_schemas) >= 1
    assert isinstance(model_schemas[0], AIModelEntity)


@pytest.mark.parametrize("setup_openai_mock", [["chat"]], indirect=True)
def test_validate_credentials_for_chat_model(setup_openai_mock):
    model = UpstageLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        # model name to gpt-3.5-turbo because of mocking
        model.validate_credentials(model="gpt-3.5-turbo", credentials={"upstage_api_key": "invalid_key"})

    model.validate_credentials(
        model="solar-1-mini-chat", credentials={"upstage_api_key": os.environ.get("UPSTAGE_API_KEY")}
    )


@pytest.mark.parametrize("setup_openai_mock", [["chat"]], indirect=True)
def test_invoke_chat_model(setup_openai_mock):
    model = UpstageLargeLanguageModel()

    result = model.invoke(
        model="solar-1-mini-chat",
        credentials={"upstage_api_key": os.environ.get("UPSTAGE_API_KEY")},
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
        },
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0


@pytest.mark.parametrize("setup_openai_mock", [["chat"]], indirect=True)
def test_invoke_chat_model_with_tools(setup_openai_mock):
    model = UpstageLargeLanguageModel()

    result = model.invoke(
        model="solar-1-mini-chat",
        credentials={"upstage_api_key": os.environ.get("UPSTAGE_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(
                content="what's the weather today in London?",
            ),
        ],
        model_parameters={"temperature": 0.0, "max_tokens": 100},
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
            PromptMessageTool(
                name="get_stock_price",
                description="Get the current stock price",
                parameters={
                    "type": "object",
                    "properties": {"symbol": {"type": "string", "description": "The stock symbol"}},
                    "required": ["symbol"],
                },
            ),
        ],
        stream=False,
        user="abc-123",
    )

    assert isinstance(result, LLMResult)
    assert isinstance(result.message, AssistantPromptMessage)
    assert len(result.message.tool_calls) > 0


@pytest.mark.parametrize("setup_openai_mock", [["chat"]], indirect=True)
def test_invoke_stream_chat_model(setup_openai_mock):
    model = UpstageLargeLanguageModel()

    result = model.invoke(
        model="solar-1-mini-chat",
        credentials={"upstage_api_key": os.environ.get("UPSTAGE_API_KEY")},
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
    model = UpstageLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="solar-1-mini-chat",
        credentials={"upstage_api_key": os.environ.get("UPSTAGE_API_KEY")},
        prompt_messages=[UserPromptMessage(content="Hello World!")],
    )

    assert num_tokens == 13

    num_tokens = model.get_num_tokens(
        model="solar-1-mini-chat",
        credentials={"upstage_api_key": os.environ.get("UPSTAGE_API_KEY")},
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

    assert num_tokens == 106
