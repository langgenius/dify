import json
import os
from unittest.mock import patch

from core.model_providers.providers.openai_provider import OpenAIProvider
from core.model_providers.models.embedding.openai_embedding import OpenAIEmbedding
from models.provider import Provider, ProviderType


def get_mock_provider(valid_openai_api_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='openai',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({'openai_api_key': valid_openai_api_key}),
        is_valid=True,
    )


def get_mock_openai_embedding_model():
    model_name = 'text-embedding-ada-002'
    valid_openai_api_key = os.environ['OPENAI_API_KEY']
    openai_provider = OpenAIProvider(provider=get_mock_provider(valid_openai_api_key))
    return OpenAIEmbedding(
        model_provider=openai_provider,
        name=model_name
    )


def decrypt_side_effect(tenant_id, encrypted_openai_api_key):
    return encrypted_openai_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_embedding(mock_decrypt):
    embedding_model = get_mock_openai_embedding_model()
    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 1536
