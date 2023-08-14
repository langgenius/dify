import json
import os
from unittest.mock import patch, MagicMock

from core.model_providers.models.embedding.replicate_embedding import ReplicateEmbedding
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.replicate_provider import ReplicateProvider
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider():
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='replicate',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config='',
        is_valid=True,
    )


def get_mock_embedding_model(mocker):
    model_name = 'replicate/all-mpnet-base-v2'
    valid_api_key = os.environ['REPLICATE_API_TOKEN']
    model_provider = ReplicateProvider(provider=get_mock_provider())

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='replicate',
        model_name=model_name,
        model_type=ModelType.EMBEDDINGS.value,
        encrypted_config=json.dumps({
            'replicate_api_token': valid_api_key,
            'model_version': 'b6b7585c9640cd7a9572c6e129c9549d79c9c31f0d3fdce7baac7c67ca38f305'
        }),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return ReplicateEmbedding(
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
    assert len(rst[0]) == 768


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_embed_query(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(mocker)
    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 768
