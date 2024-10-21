import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.huggingface_hub.llm.llm import HuggingfaceHubLargeLanguageModel
from tests.integration_tests.model_runtime.__mock.huggingface import setup_huggingface_mock


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_hosted_inference_api_validate_credentials(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="HuggingFaceH4/zephyr-7b-beta",
            credentials={"huggingfacehub_api_type": "hosted_inference_api", "huggingfacehub_api_token": "invalid_key"},
        )

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="fake-model",
            credentials={"huggingfacehub_api_type": "hosted_inference_api", "huggingfacehub_api_token": "invalid_key"},
        )

    model.validate_credentials(
        model="HuggingFaceH4/zephyr-7b-beta",
        credentials={
            "huggingfacehub_api_type": "hosted_inference_api",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
        },
    )


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_hosted_inference_api_invoke_model(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    response = model.invoke(
        model="HuggingFaceH4/zephyr-7b-beta",
        credentials={
            "huggingfacehub_api_type": "hosted_inference_api",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
        },
        prompt_messages=[UserPromptMessage(content="Who are you?")],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_hosted_inference_api_invoke_stream_model(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    response = model.invoke(
        model="HuggingFaceH4/zephyr-7b-beta",
        credentials={
            "huggingfacehub_api_type": "hosted_inference_api",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
        },
        prompt_messages=[UserPromptMessage(content="Who are you?")],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_inference_endpoints_text_generation_validate_credentials(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="openchat/openchat_3.5",
            credentials={
                "huggingfacehub_api_type": "inference_endpoints",
                "huggingfacehub_api_token": "invalid_key",
                "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT_GEN_ENDPOINT_URL"),
                "task_type": "text-generation",
            },
        )

    model.validate_credentials(
        model="openchat/openchat_3.5",
        credentials={
            "huggingfacehub_api_type": "inference_endpoints",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
            "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT_GEN_ENDPOINT_URL"),
            "task_type": "text-generation",
        },
    )


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_inference_endpoints_text_generation_invoke_model(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    response = model.invoke(
        model="openchat/openchat_3.5",
        credentials={
            "huggingfacehub_api_type": "inference_endpoints",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
            "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT_GEN_ENDPOINT_URL"),
            "task_type": "text-generation",
        },
        prompt_messages=[UserPromptMessage(content="Who are you?")],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_inference_endpoints_text_generation_invoke_stream_model(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    response = model.invoke(
        model="openchat/openchat_3.5",
        credentials={
            "huggingfacehub_api_type": "inference_endpoints",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
            "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT_GEN_ENDPOINT_URL"),
            "task_type": "text-generation",
        },
        prompt_messages=[UserPromptMessage(content="Who are you?")],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_inference_endpoints_text2text_generation_validate_credentials(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="google/mt5-base",
            credentials={
                "huggingfacehub_api_type": "inference_endpoints",
                "huggingfacehub_api_token": "invalid_key",
                "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT2TEXT_GEN_ENDPOINT_URL"),
                "task_type": "text2text-generation",
            },
        )

    model.validate_credentials(
        model="google/mt5-base",
        credentials={
            "huggingfacehub_api_type": "inference_endpoints",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
            "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT2TEXT_GEN_ENDPOINT_URL"),
            "task_type": "text2text-generation",
        },
    )


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_inference_endpoints_text2text_generation_invoke_model(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    response = model.invoke(
        model="google/mt5-base",
        credentials={
            "huggingfacehub_api_type": "inference_endpoints",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
            "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT2TEXT_GEN_ENDPOINT_URL"),
            "task_type": "text2text-generation",
        },
        prompt_messages=[UserPromptMessage(content="Who are you?")],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=False,
        user="abc-123",
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0


@pytest.mark.parametrize("setup_huggingface_mock", [["none"]], indirect=True)
def test_inference_endpoints_text2text_generation_invoke_stream_model(setup_huggingface_mock):
    model = HuggingfaceHubLargeLanguageModel()

    response = model.invoke(
        model="google/mt5-base",
        credentials={
            "huggingfacehub_api_type": "inference_endpoints",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
            "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT2TEXT_GEN_ENDPOINT_URL"),
            "task_type": "text2text-generation",
        },
        prompt_messages=[UserPromptMessage(content="Who are you?")],
        model_parameters={
            "temperature": 1.0,
            "top_k": 2,
            "top_p": 0.5,
        },
        stop=["How"],
        stream=True,
        user="abc-123",
    )

    assert isinstance(response, Generator)

    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        assert len(chunk.delta.message.content) > 0 if chunk.delta.finish_reason is None else True


def test_get_num_tokens():
    model = HuggingfaceHubLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="google/mt5-base",
        credentials={
            "huggingfacehub_api_type": "inference_endpoints",
            "huggingfacehub_api_token": os.environ.get("HUGGINGFACE_API_KEY"),
            "huggingfacehub_endpoint_url": os.environ.get("HUGGINGFACE_TEXT2TEXT_GEN_ENDPOINT_URL"),
            "task_type": "text2text-generation",
        },
        prompt_messages=[UserPromptMessage(content="Hello World!")],
    )

    assert num_tokens == 7
