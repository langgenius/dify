import json
import os
from unittest.mock import patch, MagicMock

from langchain.schema import Document

from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.models.reranking.xinference_reranking import XinferenceReranking
from core.model_providers.providers.xinference_provider import XinferenceProvider
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider(valid_server_url, valid_model_uid):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='xinference',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({'server_url': valid_server_url, 'model_uid': valid_model_uid}),
        is_valid=True,
    )


def get_mock_model(mocker):
    valid_server_url = os.environ['XINFERENCE_SERVER_URL']
    valid_model_uid = os.environ['XINFERENCE_MODEL_UID']
    model_name = 'bge-reranker-base'
    provider = XinferenceProvider(provider=get_mock_provider(valid_server_url, valid_model_uid))

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='xinference',
        model_name=model_name,
        model_type=ModelType.RERANKING.value,
        encrypted_config=json.dumps({
            'server_url': valid_server_url,
            'model_uid': valid_model_uid
        }),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return XinferenceReranking(
        model_provider=provider,
        name=model_name
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt, mocker):
    model = get_mock_model(mocker)

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
