import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.azure_ai_studio.rerank.rerank import AzureAIStudioRerankModel


def test_validate_credentials():
    model = AzureAIStudioRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="azure-ai-studio-rerank-v1",
            credentials={"api_key": "invalid_key", "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE")},
            query="What is the capital of the United States?",
            docs=[
                "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
                "Census, Carson City had a population of 55,274.",
                "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
                "are a political division controlled by the United States. Its capital is Saipan.",
            ],
            score_threshold=0.8,
        )


def test_invoke_model():
    model = AzureAIStudioRerankModel()

    result = model.invoke(
        model="azure-ai-studio-rerank-v1",
        credentials={
            "api_key": os.getenv("AZURE_AI_STUDIO_JWT_TOKEN"),
            "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE"),
        },
        query="What is the capital of the United States?",
        docs=[
            "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
            "Census, Carson City had a population of 55,274.",
            "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
            "are a political division controlled by the United States. Its capital is Saipan.",
        ],
        score_threshold=0.8,
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].index == 1
    assert result.docs[0].score >= 0.8
