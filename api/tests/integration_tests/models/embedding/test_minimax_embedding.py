import json
import os
from unittest.mock import patch

from core.model_providers.models.embedding.minimax_embedding import MinimaxEmbedding
from core.model_providers.providers.minimax_provider import MinimaxProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_group_id, valid_api_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='minimax',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({
            'minimax_group_id': valid_group_id,
            'minimax_api_key': valid_api_key
        }),
        is_valid=True,
    )


def get_mock_embedding_model():
    model_name = 'embo-01'
    valid_api_key = os.environ['MINIMAX_API_KEY']
    valid_group_id = os.environ['MINIMAX_GROUP_ID']
    provider = MinimaxProvider(provider=get_mock_provider(valid_group_id, valid_api_key))
    return MinimaxEmbedding(
        model_provider=provider,
        name=model_name
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_embedding(mock_decrypt):
    embedding_model = get_mock_embedding_model()
    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 1536
