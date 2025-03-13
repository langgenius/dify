import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gitee_ai.rerank.rerank import GiteeAIRerankModel


def test_validate_credentials():
    model = GiteeAIRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="bge-reranker-v2-m3",
            credentials={"api_key": "invalid_key"},
        )

    model.validate_credentials(
        model="bge-reranker-v2-m3",
        credentials={
            "api_key": os.environ.get("GITEE_AI_API_KEY"),
        },
    )


def test_invoke_model():
    model = GiteeAIRerankModel()
    result = model.invoke(
        model="bge-reranker-v2-m3",
        credentials={
            "api_key": os.environ.get("GITEE_AI_API_KEY"),
        },
        query="What is the capital of the United States?",
        docs=[
            "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
            "Census, Carson City had a population of 55,274.",
            "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
            "are a political division controlled by the United States. Its capital is Saipan.",
        ],
        top_n=1,
        score_threshold=0.01,
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].score >= 0.01
