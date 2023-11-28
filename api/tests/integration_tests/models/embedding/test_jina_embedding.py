import json
import os
from unittest.mock import patch

from core.model_providers.models.embedding.jina_embedding import JinaEmbedding
from core.model_providers.providers.jina_provider import JinaProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_api_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='jina',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({
            'api_key': valid_api_key
        }),
        is_valid=True,
    )


def get_mock_embedding_model():
    model_name = 'jina-embeddings-v2-small-en'
    valid_api_key = os.environ['JINA_API_KEY']
    provider = JinaProvider(provider=get_mock_provider(valid_api_key))
    return JinaEmbedding(
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
    assert len(rst) == 512
