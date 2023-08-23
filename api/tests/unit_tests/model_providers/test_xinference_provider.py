import pytest
from unittest.mock import patch, MagicMock
import json

from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import CredentialsValidateFailedError
from core.model_providers.providers.xinference_provider import XinferenceProvider
from models.provider import ProviderType, Provider, ProviderModel

PROVIDER_NAME = 'xinference'
MODEL_PROVIDER_CLASS = XinferenceProvider
VALIDATE_CREDENTIAL = {
    'model_uid': 'fake-model-uid',
    'server_url': 'http://127.0.0.1:9997/'
}


def encrypt_side_effect(tenant_id, encrypt_key):
    return f'encrypted_{encrypt_key}'


def decrypt_side_effect(tenant_id, encrypted_key):
    return encrypted_key.replace('encrypted_', '')


def test_is_credentials_valid_or_raise_valid(mocker):
    mocker.patch('core.third_party.langchain.llms.xinference_llm.XinferenceLLM._call',
                 return_value="abc")

    MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
        model_name='username/test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        credentials=VALIDATE_CREDENTIAL.copy()
    )


def test_is_credentials_valid_or_raise_invalid():
    # raise CredentialsValidateFailedError if replicate_api_token is not in credentials
    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
            model_name='test_model_name',
            model_type=ModelType.TEXT_GENERATION,
            credentials={}
        )

    # raise CredentialsValidateFailedError if replicate_api_token is invalid
    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_model_credentials_valid_or_raise(
            model_name='test_model_name',
            model_type=ModelType.TEXT_GENERATION,
            credentials={'server_url': 'invalid'})


@patch('core.helper.encrypter.encrypt_token', side_effect=encrypt_side_effect)
def test_encrypt_model_credentials(mock_encrypt, mocker):
    api_key = 'http://127.0.0.1:9997/'

    mocker.patch('core.model_providers.providers.xinference_provider.XinferenceProvider._get_extra_credentials',
                 return_value={
                     'model_handle_type': 'generate',
                     'model_format': 'ggmlv3'
                 })

    result = MODEL_PROVIDER_CLASS.encrypt_model_credentials(
        tenant_id='tenant_id',
        model_name='test_model_name',
        model_type=ModelType.TEXT_GENERATION,
        credentials=VALIDATE_CREDENTIAL.copy()
    )
    mock_encrypt.assert_called_with('tenant_id', api_key)
    assert result['server_url'] == f'encrypted_{api_key}'


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
    encrypted_credential['server_url'] = 'encrypted_' + encrypted_credential['server_url']

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
    assert result['server_url'] == 'http://127.0.0.1:9997/'


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
    encrypted_credential['server_url'] = 'encrypted_' + encrypted_credential['server_url']

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
    middle_token = result['server_url'][6:-2]
    assert len(middle_token) == max(len(VALIDATE_CREDENTIAL['server_url']) - 8, 0)
    assert all(char == '*' for char in middle_token)
