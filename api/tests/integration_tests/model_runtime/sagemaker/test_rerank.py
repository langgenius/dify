import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.sagemaker.rerank.rerank import SageMakerRerankModel


def test_validate_credentials():
    model = SageMakerRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='bge-m3-rerank-v2',
            credentials={
                "aws_region": os.getenv("AWS_REGION"),
                "aws_access_key": os.getenv("AWS_ACCESS_KEY"),
                "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY")
            },
            query="What is the capital of the United States?",
            docs=[
                "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
                "Census, Carson City had a population of 55,274.",
                "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
                "are a political division controlled by the United States. Its capital is Saipan.",
            ],
            score_threshold=0.8
        )


def test_invoke_model():
    model = SageMakerRerankModel()

    result = model.invoke(
        model='bge-m3-rerank-v2',
        credentials={
            "aws_region": os.getenv("AWS_REGION"),
            "aws_access_key": os.getenv("AWS_ACCESS_KEY"),
            "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY")
        },
        query="What is the capital of the United States?",
        docs=[
            "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
            "Census, Carson City had a population of 55,274.",
            "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
            "are a political division controlled by the United States. Its capital is Saipan.",
        ],
        score_threshold=0.8
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].index == 1
    assert result.docs[0].score >= 0.8
