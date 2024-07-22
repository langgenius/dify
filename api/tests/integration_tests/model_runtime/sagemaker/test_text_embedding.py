import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.sagemaker.text_embedding.text_embedding import SageMakerEmbeddingModel


def test_validate_credentials():
    model = SageMakerEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='bge-m3',
            credentials={
            }
        )

    model.validate_credentials(
        model='bge-m3-embedding',
        credentials={
        }
    )


def test_invoke_model():
    model = SageMakerEmbeddingModel()

    result = model.invoke(
        model='bge-m3-embedding',
        credentials={
        },
        texts=[
            "hello",
            "world"
        ],
        user="abc-123"
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2

def test_get_num_tokens():
    model = SageMakerEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='bge-m3-embedding',
        credentials={
        },
        texts=[
        ]
    )

    assert num_tokens == 0
