import pytest
from unittest.mock import patch, MagicMock
import json

from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import CredentialsValidateFailedError
from core.model_providers.providers.huggingface_hub_provider import HuggingfaceHubProvider
from models.provider import ProviderType, Provider, ProviderModel

PROVIDER_NAME = 'huggingface_hub'
MODEL_PROVIDER_CLASS = HuggingfaceHubProvider
HOSTED_INFERENCE_API_VALIDATE_CREDENTIAL = {
    'huggingfacehub_api_type': 'hosted_inference_api',
    'huggingfacehub_api_token': 'valid_key'
}

INFERENCE_ENDPOINTS_VALIDATE_CREDENTIAL = {
    'huggingfacehub_api_type': 'inference_endpoints',
    'huggingfacehub_api_token': 'valid_key',
    'huggingfacehub_endpoint_url': 'valid_url',
    'task_type': 'text-generation'
}

def encrypt_side_effect(tenant_id, encrypt_key):
    return f'encrypted_{encrypt_key}'


def decrypt_side_effect(tenant_id, encrypted_key):
    return encrypted_key.replace('encrypted_', '')


@patch('huggingface_hub.hf_api.ModelInfo')
def test_hosted_inference_api_is_credentials_valid_or_raise_valid(mock_model_info, mocker):
    mock_model_info.return_value = MagicMock(pipeline_tag='text2text-generation', cardData={'inference': True})
    mocker.patch('huggingface_hub.hf_api.HfApi.whoami', return_value="abc")
    mocker.patch('huggingface_hub.hf_api.HfApi.model_info', return_value=mock_model_info.return_value)

    MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        credentials=HOSTED_INFERENCE_API_VALIDATE_CREDENTIAL
    )

@patch('huggingface_hub.hf_api.ModelInfo')
def test_hosted_inference_api_is_credentials_valid_or_raise_invalid(mock_model_info):
    mock_model_info.return_value = MagicMock(pipeline_tag='text2text-generation')

    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
            model_name='test_model_name',
            model_type=ModelType.TEXT_GENERATION,
            credentials={}
        )

    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
            model_name='test_model_name',
            model_type=ModelType.TEXT_GENERATION,
            credentials={
                'huggingfacehub_api_type': 'hosted_inference_api',
            })


def test_inference_endpoints_is_credentials_valid_or_raise_valid(mocker):
    mocker.patch('huggingface_hub.hf_api.HfApi.whoami', return_value=None)
    mocker.patch('core.third_party.langchain.llms.huggingface_endpoint_llm.HuggingFaceEndpointLLM._call', return_value="abc")

    MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        credentials=INFERENCE_ENDPOINTS_VALIDATE_CREDENTIAL
    )


def test_inference_endpoints_is_credentials_valid_or_raise_invalid(mocker):
    mocker.patch('huggingface_hub.hf_api.HfApi.whoami', return_value=None)
    mocker.patch('core.third_party.langchain.llms.huggingface_endpoint_llm.HuggingFaceEndpointLLM._call', return_value="abc")

    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
            model_name='test_model_name',
            model_type=ModelType.TEXT_GENERATION,
            credentials={}
        )

    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
            model_name='test_model_name',
            model_type=ModelType.TEXT_GENERATION,
            credentials={
                'huggingfacehub_api_type': 'inference_endpoints',
                'huggingfacehub_endpoint_url': 'valid_url'
            })


@patch('core.helper.encrypter.encrypt_token', side_effect=encrypt_side_effect)
def test_encrypt_model_credentials(mock_encrypt):
    api_key = 'valid_key'
    result = MODEL_PROVIDER_CLASS.encrypt_model_credentials(
        tenant_id='tenant_id',
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        credentials=INFERENCE_ENDPOINTS_VALIDATE_CREDENTIAL.copy()
    )
    mock_encrypt.assert_called_with('tenant_id', api_key)
    assert result['huggingfacehub_api_token'] == f'encrypted_{api_key}'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_model_credentials_custom(mock_decrypt, mocker):
    provider = Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name=PROVIDER_NAME,
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=None,
        is_valid=True,
    )

    encrypted_credential = INFERENCE_ENDPOINTS_VALIDATE_CREDENTIAL.copy()
    encrypted_credential['huggingfacehub_api_token'] = 'encrypted_' + encrypted_credential['huggingfacehub_api_token']

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        encrypted_config=json.dumps(encrypted_credential)
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    model_provider = MODEL_PROVIDER_CLASS(provider=provider)
    result = model_provider.get_model_credentials(
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION
    )
    assert result['huggingfacehub_api_token'] == 'valid_key'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_model_credentials_obfuscated(mock_decrypt, mocker):
    provider = Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name=PROVIDER_NAME,
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=None,
        is_valid=True,
    )

    encrypted_credential = INFERENCE_ENDPOINTS_VALIDATE_CREDENTIAL.copy()
    encrypted_credential['huggingfacehub_api_token'] = 'encrypted_' + encrypted_credential['huggingfacehub_api_token']

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        encrypted_config=json.dumps(encrypted_credential)
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    model_provider = MODEL_PROVIDER_CLASS(provider=provider)
    result = model_provider.get_model_credentials(
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        obfuscated=True
    )
    middle_token = result['huggingfacehub_api_token'][6:-2]
    assert len(middle_token) == max(len(INFERENCE_ENDPOINTS_VALIDATE_CREDENTIAL['huggingfacehub_api_token']) - 8, 0)
    assert all(char == '*' for char in middle_token)
