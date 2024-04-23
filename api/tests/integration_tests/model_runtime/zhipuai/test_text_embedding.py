import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.zhipuai.text_embedding.text_embedding import ZhipuAITextEmbeddingModel


def test_validate_credentials():
    model = ZhipuAITextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='text_embedding',
            credentials={
                'api_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='text_embedding',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
        }
    )


def test_invoke_model():
    model = ZhipuAITextEmbeddingModel()

    result = model.invoke(
        model='text_embedding',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
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
    model = ZhipuAITextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='text_embedding',
        credentials={
            'api_key': os.environ.get('ZHIPUAI_API_KEY')
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert num_tokens == 2
