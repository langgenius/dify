import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.jina.text_embedding.text_embedding import JinaTextEmbeddingModel


def test_validate_credentials():
    model = JinaTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="jina-embeddings-v2-base-en", credentials={"api_key": "invalid_key"})

    model.validate_credentials(
        model="jina-embeddings-v2-base-en", credentials={"api_key": os.environ.get("JINA_API_KEY")}
    )


def test_invoke_model():
    model = JinaTextEmbeddingModel()

    result = model.invoke(
        model="jina-embeddings-v2-base-en",
        credentials={
            "api_key": os.environ.get("JINA_API_KEY"),
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 6


def test_get_num_tokens():
    model = JinaTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="jina-embeddings-v2-base-en",
        credentials={
            "api_key": os.environ.get("JINA_API_KEY"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 6
