import json
import os
from unittest.mock import patch

from langchain.schema import ChatGeneration, AIMessage

from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs
from core.model_providers.models.llm.anthropic_model import AnthropicModel
from core.model_providers.providers.anthropic_provider import AnthropicProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_api_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='anthropic',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({'anthropic_api_key': valid_api_key}),
        is_valid=True,
    )


def get_mock_model(model_name):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0
    )
    valid_api_key = os.environ['ANTHROPIC_API_KEY']
    model_provider = AnthropicProvider(provider=get_mock_provider(valid_api_key))
    return AnthropicModel(
        model_provider=model_provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_num_tokens(mock_decrypt):
    model = get_mock_model('claude-2')
    rst = model.get_num_tokens([
        PromptMessage(type=MessageType.USER, content='Who is your manufacturer?')
    ])
    assert rst == 6


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    model = get_mock_model('claude-2')
    messages = [PromptMessage(content='Human: 1 + 1=? \nAssistant: ')]
    rst = model.run(
        messages,
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
