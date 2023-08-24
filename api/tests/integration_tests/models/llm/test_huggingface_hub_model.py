import json
import os
from unittest.mock import patch, MagicMock

from langchain.schema import Generation

from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs, ModelType
from core.model_providers.models.llm.huggingface_hub_model import HuggingfaceHubModel
from core.model_providers.providers.huggingface_hub_provider import HuggingfaceHubProvider
from models.provider import Provider, ProviderType, ProviderModel


def get_mock_provider():
    return Provider(
        id='provider_id',
        tenant_id='tenant_id',
        provider_name='huggingface_hub',
        provider_type=ProviderType.CUSTOM.value,
        encrypted_config='',
        is_valid=True,
    )


def get_mock_model(model_name, huggingfacehub_api_type, mocker):
    model_kwargs = ModelKwargs(
        max_tokens=10,
        temperature=0.01
    )
    valid_api_key = os.environ['HUGGINGFACE_API_KEY']
    endpoint_url = os.environ['HUGGINGFACE_ENDPOINT_URL']
    model_provider = HuggingfaceHubProvider(provider=get_mock_provider())

    credentials = {
        'huggingfacehub_api_type': huggingfacehub_api_type,
        'huggingfacehub_api_token': valid_api_key
    }

    if huggingfacehub_api_type == 'inference_endpoints':
        credentials['huggingfacehub_endpoint_url'] = endpoint_url

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = ProviderModel(
        provider_name='huggingface_hub',
        model_name=model_name,
        model_type=ModelType.TEXT_GENERATION.value,
        encrypted_config=json.dumps(credentials),
        is_valid=True,
    )
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    return HuggingfaceHubModel(
        model_provider=model_provider,
        name=model_name,
        model_kwargs=model_kwargs
    )


def decrypt_side_effect(tenant_id, encrypted_api_key):
    return encrypted_api_key

@patch('huggingface_hub.hf_api.ModelInfo')
@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_hosted_inference_api_get_num_tokens(mock_decrypt, mock_model_info, mocker):
    mock_model_info.return_value = MagicMock(pipeline_tag='text2text-generation')
    mocker.patch('langchain.llms.huggingface_hub.HuggingFaceHub._call', return_value="abc")

    model = get_mock_model(
        'tiiuae/falcon-40b',
        'hosted_inference_api',
        mocker
    )
    rst = model.get_num_tokens([
        PromptMessage(type=MessageType.HUMAN, content='Who is your manufacturer?')
    ])
    assert rst == 5


@patch('huggingface_hub.hf_api.ModelInfo')
@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_inference_endpoints_get_num_tokens(mock_decrypt, mock_model_info, mocker):
    mock_model_info.return_value = MagicMock(pipeline_tag='text2text-generation')
    mocker.patch('langchain.llms.huggingface_hub.HuggingFaceHub._call', return_value="abc")

    model = get_mock_model(
        '',
        'inference_endpoints',
        mocker
    )
    rst = model.get_num_tokens([
        PromptMessage(type=MessageType.HUMAN, content='Who is your manufacturer?')
    ])
    assert rst == 5


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_hosted_inference_api_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    model = get_mock_model(
        'google/flan-t5-base',
        'hosted_inference_api',
        mocker
    )

    rst = model.run(
        [PromptMessage(content='Human: Are you Really Human? you MUST only answer `y` or `n`? \nAssistant: ')],
        stop=['\nHuman:'],
    )
    assert len(rst.content) > 0
    assert rst.content.strip() == 'n'


@patch('core.helper.encrypter.decrypt_token', side_effect=decrypt_side_effect)
def test_inference_endpoints_run(mock_decrypt, mocker):
    mocker.patch('core.model_providers.providers.base.BaseModelProvider.update_last_used', return_value=None)

    model = get_mock_model(
        '',
        'inference_endpoints',
        mocker
    )

    rst = model.run(
        [PromptMessage(content='Answer the following yes/no question. Can you write a whole Haiku in a single tweet?')],
    )
    assert len(rst.content) > 0
