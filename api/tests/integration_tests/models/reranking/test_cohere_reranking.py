import json
import os
from unittest.mock import patch

from langchain.schema import Document

from core.model_providers.models.reranking.cohere_reranking import CohereReranking
from core.model_providers.providers.cohere_provider import CohereProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_api_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='cohere',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({'api_key': valid_api_key}),
        is_valid=True,
    )


def get_mock_model():
    valid_api_key = os.environ['COHERE_API_KEY']
    provider = CohereProvider(provider=get_mock_provider(valid_api_key))
    return CohereReranking(
        model_provider=provider,
        name='rerank-english-v2.0'
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt):
    model = get_mock_model()

    docs = []
    docs.append(Document(
        page_content='bye',
        metadata={
            "doc_id": 'a',
            "doc_hash": 'doc_hash',
            "document_id": 'document_id',
            "dataset_id": 'dataset_id',
        }
    ))
    docs.append(Document(
        page_content='hello',
        metadata={
            "doc_id": 'b',
            "doc_hash": 'doc_hash',
            "document_id": 'document_id',
            "dataset_id": 'dataset_id',
        }
    ))
    rst = model.rerank('hello', docs, None, 2)

    assert rst[0].page_content == 'hello'
