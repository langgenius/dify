import os

import pytest
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.cohere.text_embedding.text_embedding import CohereTextEmbeddingModel
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock


def test_validate_credentials(setup_openai_mock):
    model = CohereTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='embed-multilingual-v3.0',
            credentials={
                'api_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='embed-multilingual-v3.0',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
        }
    )


def test_invoke_model(setup_openai_mock):
    model = CohereTextEmbeddingModel()

    result = model.invoke(
        model='embed-multilingual-v3.0',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
        },
        texts=[
            "hello",
            "world",
            " ".join(["long_text"] * 100),
            " ".join(["another_long_text"] * 100)
        ],
        user="abc-123"
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 4
    assert result.usage.total_tokens == 811


def test_get_num_tokens():
    model = CohereTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='embed-multilingual-v3.0',
        credentials={
            'api_key': os.environ.get('COHERE_API_KEY')
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert num_tokens == 3
