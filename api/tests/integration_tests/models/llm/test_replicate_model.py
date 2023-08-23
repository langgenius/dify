import json
import os
from unittest.mock import patch, MagicMock

from langchain.schema import Generation

from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs, ModelType
from core.model_providers.models.llm.replicate_model import ReplicateModel
from core.model_providers.providers.replicate_provider import ReplicateProvider
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider():
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='replicate',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config='',
        is_valid=True,
    )


def get_mock_model(model_name, model_version, mocker):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0.01
    )
    valid_api_key = os.environ['REPLICATE_API_TOKEN']
    model_provider = ReplicateProvider(provider=get_mock_provider())

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='replicate',
        model_name=model_name,
        model_type=ModelType.TEXT_GENERATION.value,
        encrypted_config=json.dumps({
            'replicate_api_token': valid_api_key,
            'model_version': model_version
        }),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return ReplicateModel(
        model_provider=model_provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_get_num_tokens(mock_decrypt, mocker):
    model = get_mock_model('a16z-infra/llama-2-13b-chat', '2a7f981751ec7fdf87b5b91ad4db53683a98082e9ff7bfd12c8cd5ea85980a52', mocker)
    rst = model.get_num_tokens([
        PromptMessage(type=MessageType.HUMAN, content='Who is your manufacturer?')
    ])
    assert rst == 7


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    model = get_mock_model('a16z-infra/llama-2-13b-chat', '2a7f981751ec7fdf87b5b91ad4db53683a98082e9ff7bfd12c8cd5ea85980a52', mocker)
    messages = [PromptMessage(content='Human: 1+1=? \nAnswer: ')]
    rst = model.run(
        messages
    )
    assert len(rst.content) > 0
