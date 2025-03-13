import os
from unittest.mock import Mock, patch

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.voyage.rerank.rerank import VoyageRerankModel


def test_validate_credentials():
    model = VoyageRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="rerank-lite-1",
            credentials={"api_key": "invalid_key"},
        )
    with patch("httpx.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "data": [
                {
                    "relevance_score": 0.546875,
                    "index": 0,
                    "document": "Carson City is the capital city of the American state of Nevada. At the 2010 United "
                    "States Census, Carson City had a population of 55,274.",
                },
                {
                    "relevance_score": 0.4765625,
                    "index": 1,
                    "document": "The Commonwealth of the Northern Mariana Islands is a group of islands in the "
                    "Pacific Ocean that are a political division controlled by the United States. Its "
                    "capital is Saipan.",
                },
            ],
            "model": "rerank-lite-1",
            "usage": {"total_tokens": 96},
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        model.validate_credentials(
            model="rerank-lite-1",
            credentials={
                "api_key": os.environ.get("VOYAGE_API_KEY"),
            },
        )


def test_invoke_model():
    model = VoyageRerankModel()
    with patch("httpx.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "data": [
                {
                    "relevance_score": 0.84375,
                    "index": 0,
                    "document": "Kasumi is a girl name of Japanese origin meaning mist.",
                },
                {
                    "relevance_score": 0.4765625,
                    "index": 1,
                    "document": "Her music is a kawaii bass, a mix of future bass, pop, and kawaii music and she "
                    "leads a team named PopiParty.",
                },
            ],
            "model": "rerank-lite-1",
            "usage": {"total_tokens": 59},
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        result = model.invoke(
            model="rerank-lite-1",
            credentials={
                "api_key": os.environ.get("VOYAGE_API_KEY"),
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
