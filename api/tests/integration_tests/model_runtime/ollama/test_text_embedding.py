import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.ollama.text_embedding.text_embedding import OllamaEmbeddingModel


def test_validate_credentials():
    model = OllamaEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="mistral:text",
            credentials={
                "base_url": "http://localhost:21434",
                "mode": "chat",
                "context_size": 4096,
            },
        )

    model.validate_credentials(
        model="mistral:text",
        credentials={
            "base_url": os.environ.get("OLLAMA_BASE_URL"),
            "mode": "chat",
            "context_size": 4096,
        },
    )


def test_invoke_model():
    model = OllamaEmbeddingModel()

    result = model.invoke(
        model="mistral:text",
        credentials={
            "base_url": os.environ.get("OLLAMA_BASE_URL"),
            "mode": "chat",
            "context_size": 4096,
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


def test_get_num_tokens():
    model = OllamaEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="mistral:text",
        credentials={
            "base_url": os.environ.get("OLLAMA_BASE_URL"),
            "mode": "chat",
            "context_size": 4096,
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
