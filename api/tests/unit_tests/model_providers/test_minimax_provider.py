import pytest
from unittest.mock import patch
import json

from langchain.schema import ChatResult, ChatGeneration, AIMessage

from core.model_providers.providers.base import CredentialsValidateFailedError
from core.model_providers.providers.minimax_provider import MinimaxProvider
from models.provider import ProviderType, Provider


PROVIDER_NAME = 'minimax'
MODEL_PROVIDER_CLASS = MinimaxProvider
VALIDATE_CREDENTIAL = {
    'minimax_group_id': 'fake-group-id',
    'minimax_api_key': 'valid_key'
}


def encrypt_side_effect(tenant_id, encrypt_key):
    return f'encrypted_{encrypt_key}'


def decrypt_side_effect(tenant_id, encrypted_key):
    return encrypted_key.replace('encrypted_', '')


def test_is_provider_credentials_valid_or_raise_valid(mocker):
    mocker.patch('core.third_party.langchain.llms.minimax_llm.MinimaxChatLLM._generate',
                 return_value=ChatResult(generations=[ChatGeneration(message=AIMessage(content='abc'))]))

    MODEL_PROVIDER_CLASS.is_provider_credentials_valid_or_raise(VALIDATE_CREDENTIAL)


def test_is_provider_credentials_valid_or_raise_invalid():
    # raise CredentialsValidateFailedError if api_key is not in credentials
    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_provider_credentials_valid_or_raise({})

    credential = VALIDATE_CREDENTIAL.copy()
    credential['minimax_api_key'] = 'invalid_key'

    # raise CredentialsValidateFailedError if api_key is invalid
    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_provider_credentials_valid_or_raise(credential)


@patch('core.helper.encrypter.encrypt_token', side_effect=encrypt_side_effect)
def test_encrypt_credentials(mock_encrypt):
    api_key = 'valid_key'
    result = MODEL_PROVIDER_CLASS.encrypt_provider_credentials('tenant_id', VALIDATE_CREDENTIAL.copy())
    mock_encrypt.assert_called_with('tenant_id', api_key)
    assert result['minimax_api_key'] == f'encrypted_{api_key}'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_credentials_custom(mock_decrypt):
    encrypted_credential = VALIDATE_CREDENTIAL.copy()
    encrypted_credential['minimax_api_key'] = 'encrypted_' + encrypted_credential['minimax_api_key']

    provider = Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name=PROVIDER_NAME,
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps(encrypted_credential),
        is_valid=True,
    )
    model_provider = MODEL_PROVIDER_CLASS(provider=provider)
    result = model_provider.get_provider_credentials()
    assert result['minimax_api_key'] == 'valid_key'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_credentials_obfuscated(mock_decrypt):
    encrypted_credential = VALIDATE_CREDENTIAL.copy()
    encrypted_credential['minimax_api_key'] = 'encrypted_' + encrypted_credential['minimax_api_key']

    provider = Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name=PROVIDER_NAME,
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps(encrypted_credential),
        is_valid=True,
    )
    model_provider = MODEL_PROVIDER_CLASS(provider=provider)
    result = model_provider.get_provider_credentials(obfuscated=True)
    middle_token = result['minimax_api_key'][6:-2]
    assert len(middle_token) == max(len(VALIDATE_CREDENTIAL['minimax_api_key']) - 8, 0)
    assert all(char == '*' for char in middle_token)
