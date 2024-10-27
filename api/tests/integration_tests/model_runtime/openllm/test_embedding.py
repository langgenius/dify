import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openllm.text_embedding.text_embedding import OpenLLMTextEmbeddingModel


def test_validate_credentials():
    model = OpenLLMTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="NOT IMPORTANT",
            credentials={
                "server_url": "ww" + os.environ.get("OPENLLM_SERVER_URL"),
            },
        )

    model.validate_credentials(
        model="NOT IMPORTANT",
        credentials={
            "server_url": os.environ.get("OPENLLM_SERVER_URL"),
        },
    )


def test_invoke_model():
    model = OpenLLMTextEmbeddingModel()

    result = model.invoke(
        model="NOT IMPORTANT",
        credentials={
            "server_url": os.environ.get("OPENLLM_SERVER_URL"),
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens > 0


def test_get_num_tokens():
    model = OpenLLMTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="NOT IMPORTANT",
        credentials={
            "server_url": os.environ.get("OPENLLM_SERVER_URL"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
