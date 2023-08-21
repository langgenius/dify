import json
import os
from unittest.mock import patch, MagicMock

from core.model_providers.models.embedding.xinference_embedding import XinferenceEmbedding
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.xinference_provider import XinferenceProvider
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider():
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='xinference',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config='',
        is_valid=True,
    )


def get_mock_embedding_model(mocker):
    model_name = 'vicuna-v1.3'
    server_url = os.environ['XINFERENCE_SERVER_URL']
    model_uid = os.environ['XINFERENCE_MODEL_UID']
    model_provider = XinferenceProvider(provider=get_mock_provider())

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='xinference',
        model_name=model_name,
        model_type=ModelType.EMBEDDINGS.value,
        encrypted_config=json.dumps({
            'server_url': server_url,
            'model_uid': model_uid
        }),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return XinferenceEmbedding(
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
    assert len(rst[0]) == 4096


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_embed_query(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(mocker)
    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 4096
