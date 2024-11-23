import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.siliconflow.text_embedding.text_embedding import (
    SiliconflowTextEmbeddingModel,
)


def test_validate_credentials():
    model = SiliconflowTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="BAAI/bge-large-zh-v1.5",
            credentials={"api_key": "invalid_key"},
        )

    model.validate_credentials(
        model="BAAI/bge-large-zh-v1.5",
        credentials={
            "api_key": os.environ.get("API_KEY"),
        },
    )


def test_invoke_model():
    model = SiliconflowTextEmbeddingModel()

    result = model.invoke(
        model="BAAI/bge-large-zh-v1.5",
        credentials={
            "api_key": os.environ.get("API_KEY"),
        },
        texts=[
            "hello",
            "world",
        ],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 6


def test_get_num_tokens():
    model = SiliconflowTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="BAAI/bge-large-zh-v1.5",
        credentials={
            "api_key": os.environ.get("API_KEY"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
