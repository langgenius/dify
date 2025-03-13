import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gpustack.text_embedding.text_embedding import (
    GPUStackTextEmbeddingModel,
)


def test_validate_credentials():
    model = GPUStackTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="bge-m3",
            credentials={
                "endpoint_url": "invalid_url",
                "api_key": "invalid_api_key",
            },
        )

    model.validate_credentials(
        model="bge-m3",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
    )


def test_invoke_model():
    model = GPUStackTextEmbeddingModel()

    result = model.invoke(
        model="bge-m3",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
            "context_size": 8192,
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 7
