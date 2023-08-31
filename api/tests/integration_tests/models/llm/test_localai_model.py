import json
import os
from unittest.mock import patch, MagicMock

from core.model_providers.models.llm.localai_model import LocalAIModel
from core.model_providers.providers.localai_provider import LocalAIProvider
from core.model_providers.models.entity.message import PromptMessage
from core.model_providers.models.entity.model_params import ModelKwargs, ModelType
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider(server_url):
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='localai',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config=json.dumps({}),
        is_valid=True,
    )


def get_mock_model(model_name, mocker):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0
    )
    server_url = os.environ['LOCALAI_SERVER_URL']

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='localai',
        model_name=model_name,
        model_type=ModelType.TEXT_GENERATION.value,
        encrypted_config=json.dumps({'server_url': server_url, 'completion_type': 'completion'}),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    openai_provider = LocalAIProvider(provider=get_mock_provider(server_url))
    return LocalAIModel(
        model_provider=openai_provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_openai_api_key):
    return encrypted_openai_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_num_tokens(mock_decrypt, mocker):
    openai_model = get_mock_model('ggml-gpt4all-j', mocker)
    rst = openai_model.get_num_tokens([PromptMessage(content='you are a kindness Assistant.')])
    assert rst > 0


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    openai_model = get_mock_model('ggml-gpt4all-j', mocker)
    rst = openai_model.run(
        [PromptMessage(content='Human: Are you Human? you MUST only answer `y` or `n`? \nAssistant: ')],
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
