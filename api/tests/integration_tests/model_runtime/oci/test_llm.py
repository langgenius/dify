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
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.oci.llm.llm import OCILargeLanguageModel


def test_validate_credentials():
    model = OCILargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="cohere.command-r-plus",
            credentials={"oci_config_content": "invalid_key", "oci_key_content": "invalid_key"},
        )

    model.validate_credentials(
        model="cohere.command-r-plus",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
    )


def test_invoke_model():
    model = OCILargeLanguageModel()

    response = model.invoke(
        model="cohere.command-r-plus",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
        prompt_messages=[UserPromptMessage(content="Hi")],
        model_parameters={"temperature": 0.5, "max_tokens": 10},
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


def test_invoke_stream_model():
    model = OCILargeLanguageModel()

    response = model.invoke(
        model="meta.llama-3-70b-instruct",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
        prompt_messages=[UserPromptMessage(content="Hi")],
        model_parameters={"temperature": 0.5, "max_tokens": 100, "seed": 1234},
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


def test_invoke_model_with_function():
    model = OCILargeLanguageModel()

    response = model.invoke(
        model="cohere.command-r-plus",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
        prompt_messages=[UserPromptMessage(content="Hi")],
        model_parameters={"temperature": 0.5, "max_tokens": 100, "seed": 1234},
        stream=False,
        user="abc-123",
        tools=[
            PromptMessageTool(
                name="get_current_weather",
                description="Get the current weather in a given location",
                parameters={
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "The city and state e.g. San Francisco, CA"},
                        "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                    },
                    "required": ["location"],
                },
            )
        ],
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


def test_get_num_tokens():
    model = OCILargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="cohere.command-r-plus",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
    )

    assert num_tokens == 18
