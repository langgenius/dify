import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.baichuan.text_embedding.text_embedding import BaichuanTextEmbeddingModel


def test_validate_credentials():
    model = BaichuanTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='baichuan-text-embedding',
            credentials={
                'api_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='baichuan-text-embedding',
        credentials={
            'api_key': os.environ.get('BAICHUAN_API_KEY')
        }
    )


def test_invoke_model():
    model = BaichuanTextEmbeddingModel()

    result = model.invoke(
        model='baichuan-text-embedding',
        credentials={
            'api_key': os.environ.get('BAICHUAN_API_KEY'),
        },
        texts=[
            "hello",
            "world"
        ],
        user="abc-123"
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 6

def test_get_num_tokens():
    model = BaichuanTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='baichuan-text-embedding',
        credentials={
            'api_key': os.environ.get('BAICHUAN_API_KEY'),
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert num_tokens == 2

def test_max_chunks():
    model = BaichuanTextEmbeddingModel()

    result = model.invoke(
        model='baichuan-text-embedding',
        credentials={
            'api_key': os.environ.get('BAICHUAN_API_KEY'),
        },
        texts=[
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
            "hello",
            "world",
        ]
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 22