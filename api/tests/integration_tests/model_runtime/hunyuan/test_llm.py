import os
from collections.abc import Generator

import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.hunyuan.llm.llm import HunyuanLargeLanguageModel


def test_validate_credentials():
    model = HunyuanLargeLanguageModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="hunyuan-standard", credentials={"secret_id": "invalid_key", "secret_key": "invalid_key"}
        )

    model.validate_credentials(
        model="hunyuan-standard",
        credentials={
            "secret_id": os.environ.get("HUNYUAN_SECRET_ID"),
            "secret_key": os.environ.get("HUNYUAN_SECRET_KEY"),
        },
    )


def test_invoke_model():
    model = HunyuanLargeLanguageModel()

    response = model.invoke(
        model="hunyuan-standard",
        credentials={
            "secret_id": os.environ.get("HUNYUAN_SECRET_ID"),
            "secret_key": os.environ.get("HUNYUAN_SECRET_KEY"),
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
    model = HunyuanLargeLanguageModel()

    response = model.invoke(
        model="hunyuan-standard",
        credentials={
            "secret_id": os.environ.get("HUNYUAN_SECRET_ID"),
            "secret_key": os.environ.get("HUNYUAN_SECRET_KEY"),
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


def test_get_num_tokens():
    model = HunyuanLargeLanguageModel()

    num_tokens = model.get_num_tokens(
        model="hunyuan-standard",
        credentials={
            "secret_id": os.environ.get("HUNYUAN_SECRET_ID"),
            "secret_key": os.environ.get("HUNYUAN_SECRET_KEY"),
        },
        prompt_messages=[
            SystemPromptMessage(
                content="You are a helpful AI assistant.",
            ),
            UserPromptMessage(content="Hello World!"),
        ],
    )

    assert num_tokens == 14
