from typing import List, Optional, Any

import anthropic
import httpx
import pytest
from unittest.mock import patch
import json

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.schema import BaseMessage, ChatResult, ChatGeneration, AIMessage

from core.model_providers.providers.anthropic_provider import AnthropicProvider
from core.model_providers.providers.base import CredentialsValidateFailedError
from models.provider import ProviderType, Provider


PROVIDER_NAME = 'anthropic'
MODEL_PROVIDER_CLASS = AnthropicProvider
VALIDATE_CREDENTIAL_KEY = 'anthropic_api_key'


def mock_chat_generate(messages: List[BaseMessage],
                       stop: Optional[List[str]] = None,
                       run_manager: Optional[CallbackManagerForLLMRun] = None,
                       **kwargs: Any):
    return ChatResult(generations=[ChatGeneration(message=AIMessage(content='answer'))])


def mock_chat_generate_invalid(messages: List[BaseMessage],
                               stop: Optional[List[str]] = None,
                               run_manager: Optional[CallbackManagerForLLMRun] = None,
                               **kwargs: Any):
    raise anthropic.APIStatusError('Invalid credentials',
                                   response=httpx._models.Response(
                                       status_code=401,
                                       request=httpx._models.Request(
                                           method='POST',
                                           url='https://api.anthropic.com/v1/completions',
                                       )
                                   ),
                                   body=None
                                )


def encrypt_side_effect(tenant_id, encrypt_key):
    return f'encrypted_{encrypt_key}'


def decrypt_side_effect(tenant_id, encrypted_key):
    return encrypted_key.replace('encrypted_', '')


@patch('langchain.chat_models.ChatAnthropic._generate', side_effect=mock_chat_generate)
def test_is_provider_credentials_valid_or_raise_valid(mock_create):
    MODEL_PROVIDER_CLASS.is_provider_credentials_valid_or_raise({VALIDATE_CREDENTIAL_KEY: 'valid_key'})


@patch('langchain.chat_models.ChatAnthropic._generate', side_effect=mock_chat_generate_invalid)
def test_is_provider_credentials_valid_or_raise_invalid(mock_create):
    # raise CredentialsValidateFailedError if anthropic_api_key is not in credentials
    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_provider_credentials_valid_or_raise({})

    # raise CredentialsValidateFailedError if anthropic_api_key is invalid
    with pytest.raises(CredentialsValidateFailedError):
        MODEL_PROVIDER_CLASS.is_provider_credentials_valid_or_raise({VALIDATE_CREDENTIAL_KEY: 'invalid_key'})


@patch('core.helper.encrypter.encrypt_token', side_effect=encrypt_side_effect)
def test_encrypt_credentials(mock_encrypt):
    api_key = 'valid_key'
    result = MODEL_PROVIDER_CLASS.encrypt_provider_credentials('tenant_id', {VALIDATE_CREDENTIAL_KEY: api_key})
    mock_encrypt.assert_called_with('tenant_id', api_key)
    assert result[VALIDATE_CREDENTIAL_KEY] == f'encrypted_{api_key}'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_credentials_custom(mock_decrypt):
    provider = Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name=PROVIDER_NAME,
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({VALIDATE_CREDENTIAL_KEY: 'encrypted_valid_key'}),
        is_valid=True,
    )
    model_provider = MODEL_PROVIDER_CLASS(provider=provider)
    result = model_provider.get_provider_credentials()
    assert result[VALIDATE_CREDENTIAL_KEY] == 'valid_key'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_credentials_obfuscated(mock_decrypt):
    api_key = 'valid_key'
    provider = Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name=PROVIDER_NAME,
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({VALIDATE_CREDENTIAL_KEY: f'encrypted_{api_key}'}),
        is_valid=True,
    )
    model_provider = MODEL_PROVIDER_CLASS(provider=provider)
    result = model_provider.get_provider_credentials(obfuscated=True)
    middle_token = result[VALIDATE_CREDENTIAL_KEY][6:-2]
    assert len(middle_token) == max(len(api_key) - 8, 0)
    assert all(char == '*' for char in middle_token)


@patch('core.model_providers.providers.hosted.hosted_model_providers.anthropic')
def test_get_credentials_hosted(mock_hosted):
    provider = Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name=PROVIDER_NAME,
        provider_type=ProviderType.SYSTEM.value,
        encrypted_config='',
        is_valid=True,
    )
    model_provider = MODEL_PROVIDER_CLASS(provider=provider)
    mock_hosted.api_key = 'hosted_key'
    result = model_provider.get_provider_credentials()
    assert result[VALIDATE_CREDENTIAL_KEY] == 'hosted_key'
