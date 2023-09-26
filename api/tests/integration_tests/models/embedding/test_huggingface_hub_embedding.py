import json
import os
from unittest.mock import patch, MagicMock

from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.models.embedding.huggingface_embedding import HuggingfaceEmbedding
from core.model_providers.providers.huggingface_hub_provider import HuggingfaceHubProvider
from models.provider import Provider, ProviderType, ProviderModel

DEFAULT_MODEL_NAME = 'obrizum/all-MiniLM-L6-v2'

def get_mock_provider():
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='huggingface_hub',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config='',
        is_valid=True,
    )


def get_mock_embedding_model(model_name, huggingfacehub_api_type, mocker):
    valid_api_key = os.environ['HUGGINGFACE_API_KEY']
    endpoint_url = os.environ['HUGGINGFACE_EMBEDDINGS_ENDPOINT_URL']
    model_provider = HuggingfaceHubProvider(provider=get_mock_provider())

    credentials = {
        'huggingfacehub_api_type': huggingfacehub_api_type,
        'huggingfacehub_api_token': valid_api_key,
        'task_type': 'feature-extraction'
    }

    if huggingfacehub_api_type == 'inference_endpoints':
        credentials['huggingfacehub_endpoint_url'] = endpoint_url

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='huggingface_hub',
        model_name=model_name,
        model_type=ModelType.EMBEDDINGS.value,
        encrypted_config=json.dumps(credentials),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query',
                 return_value=mock_query)

    return HuggingfaceEmbedding(
        model_provider=model_provider,
        name=model_name
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_hosted_inference_api_embed_documents(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(
        DEFAULT_MODEL_NAME,
        'hosted_inference_api',
        mocker)
    rst = embedding_model.client.embed_documents(['test', 'test1'])
    assert isinstance(rst, list)
    assert len(rst) == 2
    assert len(rst[0]) == 384


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_endpoint_url_inference_api_embed_documents(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(
        '',
        'inference_endpoints',
        mocker)
    mocker.patch('core.third_party.langchain.embeddings.huggingface_hub_embedding.InferenceClient.post'
                 , return_value=bytes(json.dumps([[1, 2, 3], [4, 5, 6]]), 'utf-8'))
    
    rst = embedding_model.client.embed_documents(['test', 'test1'])
    assert isinstance(rst, list)
    assert len(rst) == 2
    assert len(rst[0]) == 3

@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_endpoint_url_inference_api_embed_documents_two(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(
        '',
        'inference_endpoints',
        mocker)
    mocker.patch('core.third_party.langchain.embeddings.huggingface_hub_embedding.InferenceClient.post'
                 , return_value=bytes(json.dumps([[[[1,2,3],[4,5,6],[7,8,9]]],[[[1,2,3],[4,5,6],[7,8,9]]]]), 'utf-8'))
    
    rst = embedding_model.client.embed_documents(['test', 'test1'])
    assert isinstance(rst, list)
    assert len(rst) == 2
    assert len(rst[0]) == 3


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_hosted_inference_api_embed_query(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(
        DEFAULT_MODEL_NAME,
        'hosted_inference_api',
        mocker)
    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 384


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_endpoint_url_inference_api_embed_query(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(
        '',
        'inference_endpoints',
        mocker)
    
    mocker.patch('core.third_party.langchain.embeddings.huggingface_hub_embedding.InferenceClient.post'
                 , return_value=bytes(json.dumps([[1, 2, 3]]), 'utf-8'))

    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 3

@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_endpoint_url_inference_api_embed_query_two(mock_decrypt, mocker):
    embedding_model = get_mock_embedding_model(
        '',
        'inference_endpoints',
        mocker)
    
    mocker.patch('core.third_party.langchain.embeddings.huggingface_hub_embedding.InferenceClient.post'
                 , return_value=bytes(json.dumps([[[[1,2,3],[4,5,6],[7,8,9]]]]), 'utf-8'))

    rst = embedding_model.client.embed_query('test')
    assert isinstance(rst, list)
    assert len(rst) == 3