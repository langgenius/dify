import os
from unittest.mock import Mock, patch

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.mixedbread.rerank.rerank import MixedBreadRerankModel


def test_validate_credentials():
    model = MixedBreadRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="mxbai-rerank-large-v1",
            credentials={"api_key": "invalid_key"},
        )
    with patch("httpx.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "usage": {"prompt_tokens": 86, "total_tokens": 86},
            "model": "mixedbread-ai/mxbai-rerank-large-v1",
            "data": [
                {
                    "index": 0,
                    "score": 0.06762695,
                    "input": "Carson City is the capital city of the American state of Nevada. At the 2010 United "
                    "States Census, Carson City had a population of 55,274.",
                    "object": "text_document",
                },
                {
                    "index": 1,
                    "score": 0.057403564,
                    "input": "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific "
                    "Ocean that are a political division controlled by the United States. Its capital is "
                    "Saipan.",
                    "object": "text_document",
                },
            ],
            "object": "list",
            "top_k": 2,
            "return_input": True,
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        model.validate_credentials(
            model="mxbai-rerank-large-v1",
            credentials={
                "api_key": os.environ.get("MIXEDBREAD_API_KEY"),
            },
        )


def test_invoke_model():
    model = MixedBreadRerankModel()
    with patch("httpx.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "usage": {"prompt_tokens": 56, "total_tokens": 56},
            "model": "mixedbread-ai/mxbai-rerank-large-v1",
            "data": [
                {
                    "index": 0,
                    "score": 0.6044922,
                    "input": "Kasumi is a girl name of Japanese origin meaning mist.",
                    "object": "text_document",
                },
                {
                    "index": 1,
                    "score": 0.0703125,
                    "input": "Her music is a kawaii bass, a mix of future bass, pop, and kawaii music and she leads a "
                    "team named PopiParty.",
                    "object": "text_document",
                },
            ],
            "object": "list",
            "top_k": 2,
            "return_input": "true",
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        result = model.invoke(
            model="mxbai-rerank-large-v1",
            credentials={
                "api_key": os.environ.get("MIXEDBREAD_API_KEY"),
            },
            query="Who is Kasumi?",
            docs=[
                "Kasumi is a girl name of Japanese origin meaning mist.",
                "Her music is a kawaii bass, a mix of future bass, pop, and kawaii music and she leads a team named "
                "PopiParty.",
            ],
            score_threshold=0.5,
        )

        assert isinstance(result, RerankResult)
        assert len(result.docs) == 1
        assert result.docs[0].index == 0
        assert result.docs[0].score >= 0.5
