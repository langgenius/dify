import os
from unittest.mock import Mock, patch

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.mixedbread.text_embedding.text_embedding import MixedBreadTextEmbeddingModel


def test_validate_credentials():
    model = MixedBreadTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="mxbai-embed-large-v1", credentials={"api_key": "invalid_key"})
    with patch("requests.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "usage": {"prompt_tokens": 3, "total_tokens": 3},
            "model": "mixedbread-ai/mxbai-embed-large-v1",
            "data": [{"embedding": [0.23333 for _ in range(1024)], "index": 0, "object": "embedding"}],
            "object": "list",
            "normalized": "true",
            "encoding_format": "float",
            "dimensions": 1024,
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        model.validate_credentials(
            model="mxbai-embed-large-v1", credentials={"api_key": os.environ.get("MIXEDBREAD_API_KEY")}
        )


def test_invoke_model():
    model = MixedBreadTextEmbeddingModel()

    with patch("requests.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "usage": {"prompt_tokens": 6, "total_tokens": 6},
            "model": "mixedbread-ai/mxbai-embed-large-v1",
            "data": [
                {"embedding": [0.23333 for _ in range(1024)], "index": 0, "object": "embedding"},
                {"embedding": [0.23333 for _ in range(1024)], "index": 1, "object": "embedding"},
            ],
            "object": "list",
            "normalized": "true",
            "encoding_format": "float",
            "dimensions": 1024,
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        result = model.invoke(
            model="mxbai-embed-large-v1",
            credentials={
                "api_key": os.environ.get("MIXEDBREAD_API_KEY"),
            },
            texts=["hello", "world"],
            user="abc-123",
        )

        assert isinstance(result, TextEmbeddingResult)
        assert len(result.embeddings) == 2
        assert result.usage.total_tokens == 6


def test_get_num_tokens():
    model = MixedBreadTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="mxbai-embed-large-v1",
        credentials={
            "api_key": os.environ.get("MIXEDBREAD_API_KEY"),
        },
        texts=["ping"],
    )

    assert num_tokens == 1
