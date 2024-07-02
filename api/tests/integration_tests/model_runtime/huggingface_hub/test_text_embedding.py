import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.huggingface_hub.text_embedding.text_embedding import (
    HuggingfaceHubTextEmbeddingModel,
)


def test_hosted_inference_api_validate_credentials():
    model = HuggingfaceHubTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='facebook/bart-base',
            credentials={
                'huggingfacehub_api_type': 'hosted_inference_api',
                'huggingfacehub_api_token': 'invalid_key',
            }
        )

    model.validate_credentials(
        model='facebook/bart-base',
        credentials={
            'huggingfacehub_api_type': 'hosted_inference_api',
            'huggingfacehub_api_token': os.environ.get('HUGGINGFACE_API_KEY'),
        }
    )


def test_hosted_inference_api_invoke_model():
    model = HuggingfaceHubTextEmbeddingModel()

    result = model.invoke(
        model='facebook/bart-base',
        credentials={
            'huggingfacehub_api_type': 'hosted_inference_api',
            'huggingfacehub_api_token': os.environ.get('HUGGINGFACE_API_KEY'),
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


def test_inference_endpoints_validate_credentials():
    model = HuggingfaceHubTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='all-MiniLM-L6-v2',
            credentials={
                'huggingfacehub_api_type': 'inference_endpoints',
                'huggingfacehub_api_token': 'invalid_key',
                'huggingface_namespace': 'Dify-AI',
                'huggingfacehub_endpoint_url': os.environ.get('HUGGINGFACE_EMBEDDINGS_ENDPOINT_URL'),
                'task_type': 'feature-extraction'
            }
        )

    model.validate_credentials(
        model='all-MiniLM-L6-v2',
        credentials={
            'huggingfacehub_api_type': 'inference_endpoints',
            'huggingfacehub_api_token': os.environ.get('HUGGINGFACE_API_KEY'),
            'huggingface_namespace': 'Dify-AI',
            'huggingfacehub_endpoint_url': os.environ.get('HUGGINGFACE_EMBEDDINGS_ENDPOINT_URL'),
            'task_type': 'feature-extraction'
        }
    )


def test_inference_endpoints_invoke_model():
    model = HuggingfaceHubTextEmbeddingModel()

    result = model.invoke(
        model='all-MiniLM-L6-v2',
        credentials={
            'huggingfacehub_api_type': 'inference_endpoints',
            'huggingfacehub_api_token': os.environ.get('HUGGINGFACE_API_KEY'),
            'huggingface_namespace': 'Dify-AI',
            'huggingfacehub_endpoint_url': os.environ.get('HUGGINGFACE_EMBEDDINGS_ENDPOINT_URL'),
            'task_type': 'feature-extraction'
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 0


def test_get_num_tokens():
    model = HuggingfaceHubTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model='all-MiniLM-L6-v2',
        credentials={
            'huggingfacehub_api_type': 'inference_endpoints',
            'huggingfacehub_api_token': os.environ.get('HUGGINGFACE_API_KEY'),
            'huggingface_namespace': 'Dify-AI',
            'huggingfacehub_endpoint_url': os.environ.get('HUGGINGFACE_EMBEDDINGS_ENDPOINT_URL'),
            'task_type': 'feature-extraction'
        },
        texts=[
            "hello",
            "world"
        ]
    )

    assert num_tokens == 2
