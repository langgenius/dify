import json
import os
from unittest.mock import patch

from langchain.schema import Document

from core.model_providers.models.reranking.xinference_reranking import XinferenceReranking
from core.model_providers.providers.xinference_provider import XinferenceProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_server_url, valid_model_uid):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='xinference',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({'server_url': valid_server_url, 'model_uid': valid_model_uid}),
        is_valid=True,
    )


def get_mock_model():
    valid_server_url = os.environ['XINFERENCE_SERVER_URL']
    valid_model_uid = os.environ['XINFERENCE_MODEL_UID']
    provider = XinferenceProvider(provider=get_mock_provider(valid_server_url, valid_model_uid))
    return XinferenceReranking(
        model_provider=provider,
        name='bge-reranker-base'
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
