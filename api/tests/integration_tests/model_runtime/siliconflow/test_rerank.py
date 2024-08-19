import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.siliconflow.rerank.rerank import SiliconflowRerankModel


def test_validate_credentials():
    model = SiliconflowRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="BAAI/bge-reranker-v2-m3",
            credentials={
                "api_key": "invalid_key"
            },
        )

    model.validate_credentials(
        model="BAAI/bge-reranker-v2-m3",
        credentials={
            "api_key": os.environ.get("API_KEY"),
        },
    )


def test_invoke_model():
    model = SiliconflowRerankModel()

    result = model.invoke(
        model='BAAI/bge-reranker-v2-m3',
        credentials={
            "api_key": os.environ.get("API_KEY"),
        },
        query="Who is Kasumi?",
        docs=[
            "Kasumi is a girl's name of Japanese origin meaning \"mist\".",
            "Her music is a kawaii bass, a mix of future bass, pop, and kawaii music ",
            "and she leads a team named PopiParty."
        ],
        score_threshold=0.8
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].index == 0
    assert result.docs[0].score >= 0.8
