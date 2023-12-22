import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.xinference.text_embedding.text_embedding import XinferenceTextEmbeddingModel

def test_validate_credentials():
    model = XinferenceTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='bge-base-en',
            credentials={
                'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
                'model_type': 'embeddings',
                'model_name': 'NOT IMPORTANT',
                'model_uid': 'www ' + os.environ.get('XINFERENCE_EMBEDDINGS_MODEL_UID')
            }
        )

    model.validate_credentials(
        model='bge-base-en',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_type': 'embeddings',
            'model_name': 'NOT IMPORTANT',
            'model_uid': os.environ.get('XINFERENCE_EMBEDDINGS_MODEL_UID')
        }
    )


def test_invoke_model():
    model = XinferenceTextEmbeddingModel()

    result = model.invoke(
        model='bge-base-en',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_type': 'embeddings',
            'model_name': 'NOT IMPORTANT',
            'model_uid': os.environ.get('XINFERENCE_EMBEDDINGS_MODEL_UID')
        },
        texts=[
            "hello",
            "world"
        ],
        user="abc-123"
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens > 0

def test_get_num_tokens():
    model = XinferenceTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='bge-base-en',
        texts=[
            "hello",
            "world"
        ]
    )

    assert num_tokens == 2
