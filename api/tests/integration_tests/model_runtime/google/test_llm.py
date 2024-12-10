import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.google.llm.llm import GoogleLargeLanguageModel
from tests.integration_tests.model_runtime.__mock.google import setup_google_mock, setup_mock_redis


@pytest.mark.parametrize("setup_google_mock", [["none"]], indirect=True)
def test_validate_credentials(setup_google_mock):
    model = GoogleLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="gemini-pro", credentials={"google_api_key": "invalid_key"})

    model.validate_credentials(model="gemini-pro", credentials={"google_api_key": os.environ.get("GOOGLE_API_KEY")})


@pytest.mark.parametrize("setup_google_mock", [["none"]], indirect=True)
def test_invoke_model(setup_google_mock):
    model = GoogleLargeLanguageModel()

    response = model.invoke(
        model="gemini-1.5-pro",
        credentials={"google_api_key": os.environ.get("GOOGLE_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Give me your worst dad joke or i will unplug you"),
            AssistantPromptMessage(
                content="Why did the scarecrow win an award? Because he was outstanding in his field!"
            ),
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="ok something snarkier pls"),
                    TextPromptMessageContent(data="i may still unplug you"),
                ]
            ),
        ],
        model_parameters={"temperature": 0.5, "top_p": 1.0, "max_output_tokens": 2048},
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


@pytest.mark.parametrize("setup_google_mock", [["none"]], indirect=True)
def test_invoke_stream_model(setup_google_mock):
    model = GoogleLargeLanguageModel()

    response = model.invoke(
        model="gemini-1.5-pro",
        credentials={"google_api_key": os.environ.get("GOOGLE_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Give me your worst dad joke or i will unplug you"),
            AssistantPromptMessage(
                content="Why did the scarecrow win an award? Because he was outstanding in his field!"
            ),
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="ok something snarkier pls"),
                    TextPromptMessageContent(data="i may still unplug you"),
                ]
            ),
        ],
        model_parameters={"temperature": 0.2, "top_k": 5, "max_tokens": 2048},
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


@pytest.mark.parametrize("setup_google_mock", [["none"]], indirect=True)
def test_invoke_chat_model_with_vision(setup_google_mock, setup_mock_redis):
    model = GoogleLargeLanguageModel()

    result = model.invoke(
        model="gemini-1.5-pro",
        credentials={"google_api_key": os.environ.get("GOOGLE_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="what do you see?"),
                    ImagePromptMessageContent(
                        data="data:image/png;base64,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"
                    ),
                ]
            ),
        ],
        model_parameters={"temperature": 0.3, "top_p": 0.2, "top_k": 3, "max_tokens": 100},
        stream=False,
        user="abc-123",
    )

    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0


@pytest.mark.parametrize("setup_google_mock", [["none"]], indirect=True)
def test_invoke_chat_model_with_vision_multi_pics(setup_google_mock, setup_mock_redis):
    model = GoogleLargeLanguageModel()

    result = model.invoke(
        model="gemini-1.5-pro",
        credentials={"google_api_key": os.environ.get("GOOGLE_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(content="You are a helpful AI assistant."),
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="what do you see?"),
                    ImagePromptMessageContent(
                        data="data:image/png;base64,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"
                    ),
                ]
            ),
            AssistantPromptMessage(content="I see a blue letter 'D' with a gradient from light blue to dark blue."),
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="what about now?"),
                    ImagePromptMessageContent(
                        data="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAADl0lEQVR4nC3Uf0zUdRjA8S9W6w//bGs1DUd5RT+gIY0oYeEqY0QCy5EbAnF4IEgyAnGuCBANWOjih6YOlK0BbtLAX+iAENFgUBLMkzs8uDuO+wEcxx3cgdx9v3fvvn/0x+v5PM+z56/n2T6CIAgIQUEECVsICnqOoC0v8PyLW3n5lW28GhLG9hAFwYowdoRsJ+Tzv3hdEcpOxVvsfDscheI1BIXKy5t7OwiPiCI8IZaIL+OISPKxK/IDdiU6ifwqjqj4WKISP5VN8mHSFNHJA7KnfJQYh7A7+g1i9hXw2dcX2JuSxhcJnxCfnEJ8ygESqtfYl3qA5O/1pKaX8E2Rn7R0JWnKXFkRaX0OhIOqUtJVRWQoj5ChyiOjb4XMQ0fIVB0lM6eEzMO5ZN5x8W1xD1nZh1Fm55OtzOdQTgEqZR6CSi5UjSI5hTnk3bWSX/gj+ccaKCgspaDkNIWlpygc3OTYtZc4fqKcE5Vn+eFkDWUp8ZS1ryOUn66lvGmCyt/8nLwxTlXZcapqL1Nd10B1Uy01FbnUnFVS+2sLvzTWUXfRRMOAgcb6KhovdSA0XnHRdL6Zcy1/0lyTS3NfgJbWNq6cu0nrPyu0FSlpu9pF21037ZFhXLtYT+eNIbp61+jq70bofv8drvf0c2vQz+3O3+nRrNI78JD+/psMfLefe0MG7p+a5v6tP3g48ojhC7mMXP2Y0YoZRitnEcbkMPaglzEnPAoNZrw4hXH1LBOtOiYfa3gcugO1+gnqZwGeaHRMTcyhaduKRjOBxiJfQSsnWq0W7YwVrd3PtH6BaeMST40adJ3V6OwBZlR7mNUvMWswYsiKxTA1gWHOgsGiRzCmRGOcW8QoD855JObWJUxmHSb5nfd4Mc+ZMFv1MjtmuWepSMNiMmAxz2LN2o1gbdmDdV6NdVnE1p6EzajHZp7BtjCLbSnAgsMtE1k8H8OiwyuTWPL4sLduwz5vRLA7XCzbLCw7PTiswzgWJnBsijhNwzhtw6xmRLLmdLC27sU9dBC324un/iieSyF4rPIS1/8eZOOego0NL898Epv14Wz2nMHrsOB12/Glh+Mrfg/fqgufKCHmxSC21SE6JxFdKwjihhFxw4O4aUf0bSKVRyN1pyKNXEcaDUbS3EZan5Sp/zeFtLGO5LUiSRKCJAXwZ0bg73oXv+kBfrsOv8uOXxIJ/JRG4N/9sjME1B3QXAjzd8CqhqWfkT8C4T8Z5+ciRtwo8gAAAABJRU5ErkJggg=="
                    ),
                ]
            ),
        ],
        model_parameters={"temperature": 0.3, "top_p": 0.2, "top_k": 3, "max_tokens": 100},
        stream=False,
        user="abc-123",
    )

    print(f"result: {result.message.content}")
    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0


def test_get_num_tokens():
    model = GoogleLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="gemini-1.5-pro",
        credentials={"google_api_key": os.environ.get("GOOGLE_API_KEY")},
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
    )

    assert num_tokens > 0  # The exact number of tokens may vary based on the model's tokenization
