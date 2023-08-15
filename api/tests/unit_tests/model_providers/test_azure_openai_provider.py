import pytest
from unittest.mock import patch, MagicMock
import json

from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.azure_openai_provider import AzureOpenAIProvider
from core.model_providers.providers.base import CredentialsValidateFailedError
from models.provider import ProviderType, Provider, ProviderModel

PROVIDER_NAME = 'azure_openai'
MODEL_PROVIDER_CLASS = AzureOpenAIProvider
VALIDATE_CREDENTIAL = {
    'openai_api_base': 'https://xxxx.openai.azure.com/',
    'openai_api_key': 'valid_key',
    'base_model_name': 'gpt-35-turbo'
}


def encrypt_side_effect(tenant_id, encrypt_key):
    return f'encrypted_{encrypt_key}'


def decrypt_side_effect(tenant_id, encrypted_key):
    return encrypted_key.replace('encrypted_', '')


def test_is_model_credentials_valid_or_raise(mocker):
    mocker.patch('langchain.chat_models.base.BaseChatModel.generate', return_value=None)

    # assert True if credentials is valid
    MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        credentials=VALIDATE_CREDENTIAL
    )


def test_is_model_credentials_valid_or_raise_invalid():
    # raise CredentialsValidateFailedError if credentials is not in credentials
    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
            model_name='test_model_name',
            model_type=ModelType.TEXT_GENERATION,
            credentials={}
        )


@patch('core.helper.encrypter.encrypt_token', side_effect=encrypt_side_effect)
def test_encrypt_model_credentials(mock_encrypt):
    openai_api_key = 'valid_key'
    result = MODEL_PROVIDER_CLASS.encrypt_model_credentials(
        tenant_id='tenant_id',
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        credentials={'openai_api_key': openai_api_key}
    )
    mock_encrypt.assert_called_with('tenant_id', openai_api_key)
    assert result['openai_api_key'] == f'encrypted_{openai_api_key}'


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

    encrypted_credential = VALIDATE_CREDENTIAL.copy()
    encrypted_credential['openai_api_key'] = 'encrypted_' + encrypted_credential['openai_api_key']

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
    assert result['openai_api_key'] == 'valid_key'


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

    encrypted_credential = VALIDATE_CREDENTIAL.copy()
    encrypted_credential['openai_api_key'] = 'encrypted_' + encrypted_credential['openai_api_key']

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
    middle_token = result['openai_api_key'][6:-2]
    assert len(middle_token) == max(len(VALIDATE_CREDENTIAL['openai_api_key']) - 8, 0)
    assert all(char == '*' for char in middle_token)
