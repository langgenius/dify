import json
import os
from unittest.mock import patch, MagicMock

from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.azure_openai_provider import AzureOpenAIProvider
from core.model_providers.models.embedding.azure_openai_embedding import AzureOpenAIEmbedding
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider():
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='azure_openai',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config='',
        is_valid=True,
    )


def get_mock_azure_openai_embedding_model(mocker):
    model_name = 'text-embedding-ada-002'
    valid_openai_api_base = os.environ['AZURE_OPENAI_API_BASE']
    valid_openai_api_key = os.environ['AZURE_OPENAI_API_KEY']
    openai_provider = AzureOpenAIProvider(provider=get_mock_provider())

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='azure_openai',
        model_name=model_name,
        model_type=ModelType.EMBEDDINGS.value,
        encrypted_config=json.dumps({
            'openai_api_base': valid_openai_api_base,
            'openai_api_key': valid_openai_api_key,
            'base_model_name': model_name
        }),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return AzureOpenAIEmbedding(
        model_provider=openai_provider,
        name=model_name
    )


def decrypt_side_effect(tenant_id, encrypted_openai_api_key):
    return encrypted_openai_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_embedding(mock_decrypt, mocker):
    embedding_model = get_mock_azure_openai_embedding_model(mocker)
    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 1536
