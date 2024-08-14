import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.hunyuan.text_embedding.text_embedding import HunyuanTextEmbeddingModel


def test_validate_credentials():
    model = HunyuanTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='hunyuan-embedding',
            credentials={
                'secret_id': 'invalid_key',
                'secret_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='hunyuan-embedding',
        credentials={
            'secret_id': os.environ.get('HUNYUAN_SECRET_ID'),
            'secret_key': os.environ.get('HUNYUAN_SECRET_KEY')
        }
    )


def test_invoke_model():
    model = HunyuanTextEmbeddingModel()

    result = model.invoke(
        model='hunyuan-embedding',
        credentials={
            'secret_id': os.environ.get('HUNYUAN_SECRET_ID'),
            'secret_key': os.environ.get('HUNYUAN_SECRET_KEY')
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
    model = HunyuanTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='hunyuan-embedding',
        credentials={
            'secret_id': os.environ.get('HUNYUAN_SECRET_ID'),
            'secret_key': os.environ.get('HUNYUAN_SECRET_KEY')
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert num_tokens == 2

def test_max_chunks():
    model = HunyuanTextEmbeddingModel()

    result = model.invoke(
        model='hunyuan-embedding',
        credentials={
            'secret_id': os.environ.get('HUNYUAN_SECRET_ID'),
            'secret_key': os.environ.get('HUNYUAN_SECRET_KEY')
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