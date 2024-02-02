import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.azure_openai.text_embedding.text_embedding import AzureOpenAITextEmbeddingModel


@pytest.mark.parametrize('setup_openai_mock', [['text_embedding']], indirect=True)
def test_validate_credentials(setup_openai_mock):
    model = AzureOpenAITextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='embedding',
            credentials={
                'openai_api_base': os.environ.get('AZURE_OPENAI_API_BASE'),
                'openai_api_key': 'invalid_key',
                'base_model_name': 'text-embedding-ada-002'
            }
        )

    model.validate_credentials(
        model='embedding',
        credentials={
            'openai_api_base': os.environ.get('AZURE_OPENAI_API_BASE'),
            'openai_api_key': os.environ.get('AZURE_OPENAI_API_KEY'),
            'base_model_name': 'text-embedding-ada-002'
        }
    )

@pytest.mark.parametrize('setup_openai_mock', [['text_embedding']], indirect=True)
def test_invoke_model(setup_openai_mock):
    model = AzureOpenAITextEmbeddingModel()

    result = model.invoke(
        model='embedding',
        credentials={
            'openai_api_base': os.environ.get('AZURE_OPENAI_API_BASE'),
            'openai_api_key': os.environ.get('AZURE_OPENAI_API_KEY'),
            'base_model_name': 'text-embedding-ada-002'
        },
        texts=[
            "hello",
            "world"
        ],
        user="abc-123"
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


def test_get_num_tokens():
    model = AzureOpenAITextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='embedding',
        credentials={
            'base_model_name': 'text-embedding-ada-002'
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert num_tokens == 2
