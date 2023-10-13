import json
import os
from unittest.mock import patch

from langchain.schema import ChatGeneration, AIMessage, Generation

from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs
from core.model_providers.models.llm.minimax_model import MinimaxModel
from core.model_providers.models.llm.spark_model import SparkModel
from core.model_providers.providers.minimax_provider import MinimaxProvider
from core.model_providers.providers.spark_provider import SparkProvider
from models.provider import Provider, ProviderType


def get_mock_provider(valid_app_id, valid_api_key, valid_api_secret):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='spark',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({
                'app_id': valid_app_id,
                'api_key': valid_api_key,
                'api_secret': valid_api_secret,
            }),
        is_valid=True,
    )


def get_mock_model(model_name):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0.01
    )
    valid_app_id = os.environ['SPARK_APP_ID']
    valid_api_key = os.environ['SPARK_API_KEY']
    valid_api_secret = os.environ['SPARK_API_SECRET']
    model_provider = SparkProvider(provider=get_mock_provider(valid_app_id, valid_api_key, valid_api_secret))
    return SparkModel(
        model_provider=model_provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_num_tokens(mock_decrypt):
    model = get_mock_model('spark')
    rst = model.get_num_tokens([
        PromptMessage(type=MessageType.USER, content='Who is your manufacturer?')
    ])
    assert rst == 6


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    model = get_mock_model('spark')
    messages = [PromptMessage(content='Human: 1 + 1=? \nAssistant: Integer answer is:')]
    rst = model.run(
        messages,
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
