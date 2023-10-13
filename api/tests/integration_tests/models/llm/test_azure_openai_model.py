import json
import os
from unittest.mock import patch, MagicMock

import pytest
from langchain.schema import ChatGeneration, AIMessage

from core.model_providers.models.entity.model_params import ModelKwargs, ModelType
from core.model_providers.models.llm.azure_openai_model import AzureOpenAIModel
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.providers.azure_openai_provider import AzureOpenAIProvider
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


def get_mock_azure_openai_model(model_name, mocker):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0
    )
    valid_openai_api_base = os.environ['AZURE_OPENAI_API_BASE']
    valid_openai_api_key = os.environ['AZURE_OPENAI_API_KEY']
    provider = AzureOpenAIProvider(provider=get_mock_provider())

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='azure_openai',
        model_name=model_name,
        model_type=ModelType.TEXT_GENERATION.value,
        encrypted_config=json.dumps({
            'openai_api_base': valid_openai_api_base,
            'openai_api_key': valid_openai_api_key,
            'base_model_name': model_name
        }),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return AzureOpenAIModel(
        model_provider=provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_openai_api_key):
    return encrypted_openai_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_num_tokens(mock_decrypt, mocker):
    openai_model = get_mock_azure_openai_model('text-davinci-003', mocker)
    rst = openai_model.get_num_tokens([PromptMessage(content='you are a kindness Assistant.')])
    assert rst == 6


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_chat_get_num_tokens(mock_decrypt, mocker):
    openai_model = get_mock_azure_openai_model('gpt-35-turbo', mocker)
    rst = openai_model.get_num_tokens([
        PromptMessage(type=MessageType.SYSTEM, content='you are a kindness Assistant.'),
        PromptMessage(type=MessageType.USER, content='Who is your manufacturer?')
    ])
    assert rst == 22


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    openai_model = get_mock_azure_openai_model('gpt-35-turbo', mocker)
    messages = [PromptMessage(content='Human: Are you Human? you MUST only answer `y` or `n`? \nAssistant: ')]
    rst = openai_model.run(
        messages,
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
