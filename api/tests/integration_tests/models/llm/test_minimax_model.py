import json
import os
from unittest.mock import patch

from langchain.schema import ChatGeneration, AIMessage, Generation

from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs
from core.model_providers.models.llm.minimax_model import MinimaxModel
from core.model_providers.providers.minimax_provider import MinimaxProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_group_id, valid_api_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='minimax',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({
            'minimax_group_id': valid_group_id,
            'minimax_api_key': valid_api_key
        }),
        is_valid=True,
    )


def get_mock_model(model_name):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0.01
    )
    valid_api_key = os.environ['MINIMAX_API_KEY']
    valid_group_id = os.environ['MINIMAX_GROUP_ID']
    model_provider = MinimaxProvider(provider=get_mock_provider(valid_group_id, valid_api_key))
    return MinimaxModel(
        model_provider=model_provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_num_tokens(mock_decrypt):
    model = get_mock_model('abab5.5-chat')
    rst = model.get_num_tokens([
        PromptMessage(type=MessageType.HUMAN, content='Who is your manufacturer?')
    ])
    assert rst == 5


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt):
    model = get_mock_model('abab5.5-chat')
    rst = model.run(
        [PromptMessage(content='Human: Are you a real Human? you MUST only answer `y` or `n`? \nAssistant: ')],
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
    assert rst.content.strip() == 'n'
