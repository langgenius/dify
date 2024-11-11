import os
from unittest.mock import Mock, patch

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.voyage.text_embedding.text_embedding import VoyageTextEmbeddingModel


def test_validate_credentials():
    model = VoyageTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="voyage-3", credentials={"api_key": "invalid_key"})
    with patch("requests.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "data": [{"object": "embedding", "embedding": [0.23333 for _ in range(1024)], "index": 0}],
            "model": "voyage-3",
            "usage": {"total_tokens": 1},
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        model.validate_credentials(model="voyage-3", credentials={"api_key": os.environ.get("VOYAGE_API_KEY")})


def test_invoke_model():
    model = VoyageTextEmbeddingModel()

    with patch("requests.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "data": [
                {"object": "embedding", "embedding": [0.23333 for _ in range(1024)], "index": 0},
                {"object": "embedding", "embedding": [0.23333 for _ in range(1024)], "index": 1},
            ],
            "model": "voyage-3",
            "usage": {"total_tokens": 2},
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        result = model.invoke(
            model="voyage-3",
            credentials={
                "api_key": os.environ.get("VOYAGE_API_KEY"),
            },
            texts=["hello", "world"],
            user="abc-123",
        )

        assert isinstance(result, TextEmbeddingResult)
        assert len(result.embeddings) == 2
        assert result.usage.total_tokens == 2


def test_get_num_tokens():
    model = VoyageTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="voyage-3",
        credentials={
            "api_key": os.environ.get("VOYAGE_API_KEY"),
        },
        texts=["ping"],
    )

    assert num_tokens == 1
