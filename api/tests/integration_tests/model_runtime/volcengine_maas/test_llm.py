import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.volcengine_maas.llm.llm import VolcengineMaaSLargeLanguageModel


def test_validate_credentials_for_chat_model():
    model = VolcengineMaaSLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="NOT IMPORTANT",
            credentials={
                "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
                "volc_region": "cn-beijing",
                "volc_access_key_id": "INVALID",
                "volc_secret_access_key": "INVALID",
                "endpoint_id": "INVALID",
            },
        )

    model.validate_credentials(
        model="NOT IMPORTANT",
        credentials={
            "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
            "volc_region": "cn-beijing",
            "volc_access_key_id": os.environ.get("VOLC_API_KEY"),
            "volc_secret_access_key": os.environ.get("VOLC_SECRET_KEY"),
            "endpoint_id": os.environ.get("VOLC_MODEL_ENDPOINT_ID"),
        },
    )


def test_invoke_model():
    model = VolcengineMaaSLargeLanguageModel()

    response = model.invoke(
        model="NOT IMPORTANT",
        credentials={
            "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
            "volc_region": "cn-beijing",
            "volc_access_key_id": os.environ.get("VOLC_API_KEY"),
            "volc_secret_access_key": os.environ.get("VOLC_SECRET_KEY"),
            "endpoint_id": os.environ.get("VOLC_MODEL_ENDPOINT_ID"),
            "base_model_name": "Skylark2-pro-4k",
        },
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        model_parameters={
            "temperature": 0.7,
            "top_p": 1.0,
            "top_k": 1,
        },
        stop=["you"],
        user="abc-123",
        stream=False,
    )

    assert isinstance(response, LLMResult)
    assert len(response.message.content) > 0
    assert response.usage.total_tokens > 0


def test_invoke_stream_model():
    model = VolcengineMaaSLargeLanguageModel()

    response = model.invoke(
        model="NOT IMPORTANT",
        credentials={
            "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
            "volc_region": "cn-beijing",
            "volc_access_key_id": os.environ.get("VOLC_API_KEY"),
            "volc_secret_access_key": os.environ.get("VOLC_SECRET_KEY"),
            "endpoint_id": os.environ.get("VOLC_MODEL_ENDPOINT_ID"),
            "base_model_name": "Skylark2-pro-4k",
        },
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        model_parameters={
            "temperature": 0.7,
            "top_p": 1.0,
            "top_k": 1,
        },
        stop=["you"],
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
    model = VolcengineMaaSLargeLanguageModel()

    response = model.get_num_tokens(
        model="NOT IMPORTANT",
        credentials={
            "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
            "volc_region": "cn-beijing",
            "volc_access_key_id": os.environ.get("VOLC_API_KEY"),
            "volc_secret_access_key": os.environ.get("VOLC_SECRET_KEY"),
            "endpoint_id": os.environ.get("VOLC_MODEL_ENDPOINT_ID"),
            "base_model_name": "Skylark2-pro-4k",
        },
        prompt_messages=[UserPromptMessage(content="Hello World!")],
        tools=[],
    )

    assert isinstance(response, int)
    assert response == 6
