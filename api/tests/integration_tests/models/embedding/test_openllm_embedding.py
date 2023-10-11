import json
import os
from unittest.mock import patch, MagicMock

from core.model_providers.models.embedding.openllm_embedding import OpenLLMEmbedding
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.openllm_provider import OpenLLMProvider
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider():
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='openllm',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config='',
        is_valid=True,
    )


def get_mock_embedding_model(mocker):
    model_name = 'facebook/opt-125m'
    server_url = os.environ['OPENLLM_SERVER_URL']
    model_provider = OpenLLMProvider(provider=get_mock_provider())

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='openllm',
        model_name=model_name,
        model_type=ModelType.EMBEDDINGS.value,
        encrypted_config=json.dumps({
            'server_url': server_url
        }),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return OpenLLMEmbedding(
        model_provider=model_provider,
        name=model_name
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_embed_documents(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(mocker)
    rst = embedding_model.client.embed_documents(['test', 'test1'])
    assert isinstance(rst, list)
    assert len(rst) == 2
    assert len(rst[0]) > 0


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_embed_query(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(mocker)
    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) > 0
