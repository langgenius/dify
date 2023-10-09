import json
import os
from unittest.mock import patch


from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs
from core.model_providers.models.llm.baichuan_model import BaichuanModel
from core.model_providers.providers.baichuan_provider import BaichuanProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_api_key, valid_secret_key):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='baichuan',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({
            'api_key': valid_api_key,
            'secret_key': valid_secret_key,
        }),
        is_valid=True,
    )


def get_mock_model(model_name: str, streaming: bool = False):
    model_kwargs = ModelKwargs(
        temperature=0.01,
    )
    valid_api_key = os.environ['BAICHUAN_API_KEY']
    valid_secret_key = os.environ['BAICHUAN_SECRET_KEY']
    model_provider = BaichuanProvider(provider=get_mock_provider(valid_api_key, valid_secret_key))
    return BaichuanModel(
        model_provider=model_provider,
        name=model_name,
        model_kwargs=model_kwargs,
        streaming=streaming
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_chat_get_num_tokens(mock_decrypt):
    model = get_mock_model('baichuan2-53b')
    rst = model.get_num_tokens([
        PromptMessage(type=MessageType.SYSTEM, content='you are a kindness Assistant.'),
        PromptMessage(type=MessageType.HUMAN, content='Who is your manufacturer?')
    ])
    assert rst > 0


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_chat_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    model = get_mock_model('baichuan2-53b')
    messages = [
        PromptMessage(type=MessageType.HUMAN, content='Are you Human? you MUST only answer `y` or `n`?')
    ]
    rst = model.run(
        messages,
    )
    assert len(rst.content) > 0


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_chat_stream_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    model = get_mock_model('baichuan2-53b', streaming=True)
    messages = [
        PromptMessage(type=MessageType.HUMAN, content='Are you Human? you MUST only answer `y` or `n`?')
    ]
    rst = model.run(
        messages
    )
    assert len(rst.content) > 0
