import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.cohere.rerank.rerank import CohereRerankModel


def test_validate_credentials():
    model = CohereRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="rerank-english-v2.0", credentials={"api_key": "invalid_key"})

    model.validate_credentials(model="rerank-english-v2.0", credentials={"api_key": os.environ.get("COHERE_API_KEY")})


def test_invoke_model():
    model = CohereRerankModel()

    result = model.invoke(
        model="rerank-english-v2.0",
        credentials={"api_key": os.environ.get("COHERE_API_KEY")},
        query="What is the capital of the United States?",
        docs=[
            "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
            "Census, Carson City had a population of 55,274.",
            "Washington, D.C. (also known as simply Washington or D.C., and officially as the District of Columbia) "
            "is the capital of the United States. It is a federal district. The President of the USA and many major "
            "national government offices are in the territory. This makes it the political center of the United "
            "States of America.",
        ],
        score_threshold=0.8,
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].index == 1
    assert result.docs[0].score >= 0.8
