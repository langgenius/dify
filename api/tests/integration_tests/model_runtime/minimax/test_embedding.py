import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.minimax.text_embedding.text_embedding import MinimaxTextEmbeddingModel


def test_validate_credentials():
    model = MinimaxTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="embo-01",
            credentials={"minimax_api_key": "invalid_key", "minimax_group_id": os.environ.get("MINIMAX_GROUP_ID")},
        )

    model.validate_credentials(
        model="embo-01",
        credentials={
            "minimax_api_key": os.environ.get("MINIMAX_API_KEY"),
            "minimax_group_id": os.environ.get("MINIMAX_GROUP_ID"),
        },
    )


def test_invoke_model():
    model = MinimaxTextEmbeddingModel()

    result = model.invoke(
        model="embo-01",
        credentials={
            "minimax_api_key": os.environ.get("MINIMAX_API_KEY"),
            "minimax_group_id": os.environ.get("MINIMAX_GROUP_ID"),
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 16


def test_get_num_tokens():
    model = MinimaxTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="embo-01",
        credentials={
            "minimax_api_key": os.environ.get("MINIMAX_API_KEY"),
            "minimax_group_id": os.environ.get("MINIMAX_GROUP_ID"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
