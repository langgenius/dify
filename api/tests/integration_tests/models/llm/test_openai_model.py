import json
import os
from unittest.mock import patch

from langchain.schema import Generation, ChatGeneration, AIMessage

from core.model_providers.providers.openai_provider import OpenAIProvider
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs
from core.model_providers.models.llm.openai_model import OpenAIModel
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


def get_mock_openai_model(model_name):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0
    )
    model_name = model_name
    valid_openai_api_key = os.environ['OPENAI_API_KEY']
    openai_provider = OpenAIProvider(provider=get_mock_provider(valid_openai_api_key))
    return OpenAIModel(
        model_provider=openai_provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_openai_api_key):
    return encrypted_openai_api_key

@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_num_tokens(mock_decrypt):
    openai_model = get_mock_openai_model('text-davinci-003')
    rst = openai_model.get_num_tokens([PromptMessage(content='you are a kindness Assistant.')])
    assert rst == 6


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_chat_get_num_tokens(mock_decrypt):
    openai_model = get_mock_openai_model('gpt-3.5-turbo')
    rst = openai_model.get_num_tokens([
        PromptMessage(type=MessageType.SYSTEM, content='you are a kindness Assistant.'),
        PromptMessage(type=MessageType.HUMAN, content='Who is your manufacturer?')
    ])
    assert rst == 22


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    openai_model = get_mock_openai_model('text-davinci-003')
    rst = openai_model.run(
        [PromptMessage(content='Human: Are you Human? you MUST only answer `y` or `n`? \nAssistant: ')],
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
    assert rst.content.strip() == 'n'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_chat_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    openai_model = get_mock_openai_model('gpt-3.5-turbo')
    messages = [PromptMessage(content='Human: Are you Human? you MUST only answer `y` or `n`? \nAssistant: ')]
    rst = openai_model.run(
        messages,
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
