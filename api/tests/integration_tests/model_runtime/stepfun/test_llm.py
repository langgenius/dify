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
from core.model_runtime.model_providers.stepfun.llm.llm import StepfunLargeLanguageModel


def test_validate_credentials():
    model = StepfunLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="step-1-8k", credentials={"api_key": "invalid_key"})

    model.validate_credentials(model="step-1-8k", credentials={"api_key": os.environ.get("STEPFUN_API_KEY")})


def test_invoke_model():
    model = StepfunLargeLanguageModel()

    response = model.invoke(
        model="step-1-8k",
        credentials={"api_key": os.environ.get("STEPFUN_API_KEY")},
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        model_parameters={"temperature": 0.9, "top_p": 0.7},
        stop=["Hi"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


def test_invoke_stream_model():
    model = StepfunLargeLanguageModel()

    response = model.invoke(
        model="step-1-8k",
        credentials={"api_key": os.environ.get("STEPFUN_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
        model_parameters={"temperature": 0.9, "top_p": 0.7},
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


def test_get_customizable_model_schema():
    model = StepfunLargeLanguageModel()

    schema = model.get_customizable_model_schema(
        model="step-1-8k", credentials={"api_key": os.environ.get("STEPFUN_API_KEY")}
    )
    assert isinstance(schema, AIModelEntity)


def test_invoke_chat_model_with_tools():
    model = StepfunLargeLanguageModel()

    result = model.invoke(
        model="step-1-8k",
        credentials={"api_key": os.environ.get("STEPFUN_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(
                content="what's the weather today in Shanghai?",
            ),
        ],
        model_parameters={"temperature": 0.9, "max_tokens": 100},
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
