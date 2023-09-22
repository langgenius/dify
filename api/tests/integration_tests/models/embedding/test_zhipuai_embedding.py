import json
import os
from unittest.mock import patch

from core.model_providers.models.embedding.zhipuai_embedding import ZhipuAIEmbedding
from core.model_providers.providers.zhipuai_provider import ZhipuAIProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_api_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='zhipuai',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({
            'api_key': valid_api_key
        }),
        is_valid=True,
    )


def get_mock_embedding_model():
    model_name = 'text_embedding'
    valid_api_key = os.environ['ZHIPUAI_API_KEY']
    provider = ZhipuAIProvider(provider=get_mock_provider(valid_api_key))
    return ZhipuAIEmbedding(
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
    assert len(rst) == 1024


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_doc_embedding(mock_decrypt):
    embedding_model = get_mock_embedding_model()
    rst = embedding_model.client.embed_documents(['test', 'test2'])
    assert isinstance(rst, list)
    assert len(rst[0]) == 1024
